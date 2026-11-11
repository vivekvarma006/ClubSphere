import Link from "next/link";
import { ButtonLink, Card } from "@/components/ui";
import { BrandMark, Icon, type IconName } from "@/components/icons";
import { getVerifiedActor } from "@/server/auth/session";

const FEATURES: { title: string; body: string; icon: IconName }[] = [
  { title: "Find your community", body: "Discover clubs that share your interests. Join, contribute, and build something together.", icon: "users" },
  { title: "Be there for the good stuff", body: "Workshops, competitions, and conversations. A private QR gets you through the door.", icon: "calendar" },
  { title: "Every contribution counts", body: "Track the days you show up, the tasks you finish, and the challenges you solve.", icon: "bolt" },
  { title: "Keep the knowledge growing", body: "Explore guides, notes, and write-ups from the people who came before you.", icon: "compass" },
];
export default async function Home() {
  const actor = await getVerifiedActor().catch(() => null);
  return <main className="mx-auto w-full max-w-6xl px-6 pb-16">
    <header className="flex items-center justify-between py-7"><Link href="/" className="brand-lockup"><BrandMark /><span>ClubSphere</span></Link><ButtonLink variant="secondary" href={actor ? "/dashboard" : "/login"}>{actor ? "Open dashboard" : "Sign in"} ↗</ButtonLink></header>
    <div className="public-hero grid items-center gap-12 py-16 lg:grid-cols-[1.4fr_1fr] lg:py-24">
      <div><p className="eyebrow mb-5">Built for the people who show up</p>
        <h1 className="text-5xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">Find your people.<br /><span className="text-emerald-400">Make your mark.</span></h1>
        <p className="mt-6 max-w-lg text-base leading-relaxed text-zinc-400">Your clubs, events and contributions, all in one place. Less organizing. More doing things that matter.</p>
        <div className="mt-8 flex flex-wrap gap-3"><ButtonLink href={actor ? "/dashboard" : "/login"}>{actor ? "Open dashboard" : "Get started"}<Icon name="arrow" /></ButtonLink><ButtonLink variant="secondary" href="/join">Explore clubs</ButtonLink></div>
      </div>
      <div className="rounded-2xl border border-emerald-400/20 bg-[#101a13] p-7">
        <Icon name="bolt" className="mb-8 text-emerald-400" /><p className="text-2xl font-medium leading-snug">Small actions.<br />Lasting impact.</p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">A workshop attended. A teammate helped. A challenge solved. Your story, one contribution at a time.</p>
        <div className="mt-7 grid grid-cols-12 gap-1.5" aria-hidden="true">{Array.from({ length: 60 }, (_, i) => <span key={i} className={`aspect-square rounded-sm ${["heat-0", "heat-1", "heat-3", "heat-2", "heat-4"][i % 5]}`} />)}</div>
        <p className="mt-4 text-[10px] text-zinc-500">An illustration of what showing up can look like.</p>
      </div>
    </div>
    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{FEATURES.map(feature => <Card key={feature.title}><Icon name={feature.icon} className="mb-5 text-emerald-400" /><h2 className="text-sm font-semibold">{feature.title}</h2><p className="mt-2 text-xs leading-relaxed text-zinc-400">{feature.body}</p></Card>)}</div>
  </main>;
}
