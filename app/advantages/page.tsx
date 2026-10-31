import type { Metadata } from "next";
import { Boxes, Headset, ShieldCheck, Timer, Users, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import MjicPageShell from "../_components/MjicPageShell";

export const metadata: Metadata = {
  title: "Competitive Advantages | MJIC",
  description:
    "Why bulk buyers choose Michael Jeffrey International Corporation: experienced team, quality assurance, fast delivery, custom solutions, stable supply and after-sales support.",
};

const ADVANTAGES: { title: string; text: string; icon: LucideIcon }[] = [
  {
    title: "Experienced Team",
    text: "Pattern makers, cutters and line supervisors who have produced uniforms and jackets for years.",
    icon: Users,
  },
  {
    title: "Quality Assurance",
    text: "In-line and final inspection on every batch before it is packed.",
    icon: ShieldCheck,
  },
  {
    title: "Fast Delivery",
    text: "Clear production schedules with lead times set at the quotation stage.",
    icon: Timer,
  },
  {
    title: "Custom Solutions",
    text: "Fabric, cut, logo and label changes built around your brand and budget.",
    icon: Wrench,
  },
  {
    title: "Stable Supply",
    text: "Fabric sourcing and production capacity planned for repeat and seasonal orders.",
    icon: Boxes,
  },
  {
    title: "After-Sales Support",
    text: "Reorders, size adjustments and replacements handled by our sales team.",
    icon: Headset,
  },
];

export default function AdvantagesPage() {
  return (
    <MjicPageShell
      eyebrow="Competitive Advantages"
      title="Why bulk buyers choose MJIC"
      intro="Six core strengths behind every jacket, uniform and branded order that Michael Jeffrey International Corporation produces."
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ADVANTAGES.map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={item.title}
              className="rounded-xl border border-[#0B1E3D]/10 p-6 shadow-sm"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-[#F3E7C6] text-[#9C7521]">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-lg font-bold">{item.title}</h2>
              <p className="mt-2 text-sm text-[#3C567F]">{item.text}</p>
            </article>
          );
        })}
      </div>
    </MjicPageShell>
  );
}
