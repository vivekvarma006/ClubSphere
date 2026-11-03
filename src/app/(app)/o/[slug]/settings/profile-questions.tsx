"use client";

import { useState } from "react";
import { Field, buttonClass, inputClass } from "@/components/ui";

interface Question {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

export function ProfileQuestions({ initial }: { initial: Question[] }) {
  const [questions, setQuestions] = useState(initial);
  function update(index: number, patch: Partial<Question>) {
    setQuestions((current) =>
      current.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    );
  }
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 font-medium">Membership profile questions</legend>
      <input name="fields" type="hidden" value={JSON.stringify(questions)} />
      {questions.length === 0 ? (
        <p className="text-sm text-zinc-500">No additional questions.</p>
      ) : null}
      {questions.map((question, index) => (
        <div
          key={question.key}
          className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <Field label={`Question ${index + 1}`}>
            <input
              value={question.label}
              onChange={(event) => update(index, { label: event.target.value })}
              required
              maxLength={100}
              className={inputClass}
            />
          </Field>
          <Field label="Answer type">
            <select
              value={question.type}
              onChange={(event) =>
                update(index, {
                  type: event.target.value,
                  options: event.target.value === "select" ? [""] : undefined,
                })
              }
              className={inputClass}
            >
              <option value="text">Short text</option>
              <option value="long_text">Long text</option>
              <option value="number">Number</option>
              <option value="select">Choose an option</option>
              <option value="url">Website link</option>
            </select>
          </Field>
          {question.type === "select" ? (
            <Field label="Choices" hint="One choice per line.">
              <textarea
                value={question.options?.join("\n") ?? ""}
                onChange={(event) =>
                  update(index, { options: event.target.value.split("\n") })
                }
                required
                rows={3}
                className={inputClass}
              />
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(event) =>
                  update(index, { required: event.target.checked })
                }
              />
              Required answer
            </label>
            <button
              type="button"
              className={buttonClass("ghost")}
              onClick={() =>
                setQuestions((current) => current.filter((_, i) => i !== index))
              }
            >
              Remove question {index + 1}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass("secondary")}
        disabled={questions.length >= 50}
        onClick={() =>
          setQuestions((current) => [
            ...current,
            {
              key: `question_${crypto.randomUUID().slice(0, 8)}`,
              label: "",
              type: "text",
              required: false,
            },
          ])
        }
      >
        Add question
      </button>
    </fieldset>
  );
}
