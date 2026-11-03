"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { checkInAction, type CheckInState } from "@/app/actions";
import { buttonClass, cx, inputClass } from "@/components/ui";

/**
 * QR check-in scanner. Frames from the camera are decoded locally with
 * jsQR; each decoded code is sent to the server, which verifies it and
 * records attendance exactly once (private.check_in). A text box covers
 * laptops without a camera.
 */
export function Scanner({ slug, eventId }: { slug: string; eventId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "unavailable">("off");
  const [result, setResult] = useState<CheckInState | null>(null);
  const [history, setHistory] = useState<Array<{ name: string; status: string; at: number }>>([]);
  const [manual, setManual] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = useCallback(
    (code: string) => {
      startTransition(async () => {
        const outcome = await checkInAction(slug, eventId, code);
        setResult(outcome);
        if (outcome.ok) setHistory((h) => [{ name: outcome.name, status: outcome.status, at: Date.now() }, ...h].slice(0, 8));
      });
    },
    [slug, eventId],
  );

  useEffect(() => {
    if (camera !== "starting") return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelled = false;

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (cancelled || !video || !canvas) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
          const now = Date.now();
          // Ignore the same code for 3 s so one QR held in front of the camera is sent once.
          if (found?.data && !(lastCode.current?.code === found.data && now - lastCode.current.at < 3000)) {
            lastCode.current = { code: found.data, at: now };
            submit(found.data);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play();
        }
        setCamera("on");
        frame = requestAnimationFrame(tick);
      })
      .catch(() => setCamera("unavailable"));

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, submit]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900">
          <video ref={videoRef} muted playsInline className={cx("h-full w-full object-cover", camera === "on" ? "" : "hidden")} />
          {camera !== "on" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-300">
              {camera === "unavailable" ? <p>No camera available. Paste the code below instead.</p> : <p>Camera is off.</p>}
              {camera !== "unavailable" ? (
                <button
                  type="button"
                  // Camera access needs a secure context (https or localhost).
                  onClick={() => setCamera(navigator.mediaDevices ? "starting" : "unavailable")}
                  className={buttonClass("primary")}
                >
                  Start camera
                </button>
              ) : null}
            </div>
          ) : null}
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) submit(manual.trim());
            setManual("");
          }}
        >
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Or paste a code"
            aria-label="QR code text"
            className={inputClass}
          />
          <button type="submit" disabled={pending} className={buttonClass("secondary")}>
            Check in
          </button>
        </form>
      </div>

      <div className="space-y-3">
        <div
          aria-live="polite"
          className={cx(
            "rounded-xl border p-6 text-center",
            !result
              ? "border-zinc-200 text-zinc-500 dark:border-zinc-800"
              : result.ok && result.status === "checked_in"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                : result.ok
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
                  : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
          )}
        >
          {pending ? (
            <p>Checking...</p>
          ) : !result ? (
            <p>Waiting for a code.</p>
          ) : result.ok ? (
            <>
              <p className="text-2xl font-semibold">{result.name}</p>
              <p>{result.status === "checked_in" ? "Checked in" : "Already checked in earlier: not counted twice"}</p>
            </>
          ) : (
            <p className="font-medium">{result.message}</p>
          )}
        </div>
        {history.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.at} className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>{h.name}</span>
                <span>{h.status === "checked_in" ? "checked in" : "duplicate scan"}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
