import type { Metadata } from "next";
import Image from "next/image";
import {
  Boxes,
  Headset,
  Leaf,
  Palette,
  Ruler,
  ShieldCheck,
  Stamp,
  Tag,
  Timer,
  Users,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import MjicPageShell from "../_components/MjicPageShell";

export const metadata: Metadata = {
  title: "Customization Capabilities & Advantages | MJIC",
  description:
    "Fabric, color, logo, sizing, label and eco-packaging customization for bulk jackets and uniforms, plus MJIC's core business advantages.",
};

const FABRICS = [
  { src: "/images/fabrics/microfiber.svg", name: "Microfiber" },
  { src: "/images/fabrics/dri-fit.svg", name: "Dri-Fit" },
  { src: "/images/fabrics/softshell.svg", name: "Softshell" },
  { src: "/images/fabrics/cotton-fleece.svg", name: "Cotton Fleece" },
  { src: "/images/fabrics/canvas-twill.svg", name: "Canvas Twill" },
  { src: "/images/fabrics/honeycomb-pique.svg", name: "Honeycomb Pique" },
];

const COLORS = [
  { hex: "#0B1E3D", name: "Navy" },
  { hex: "#B8912F", name: "Gold" },
  { hex: "#FFFFFF", name: "White" },
  { hex: "#2B2F36", name: "Charcoal" },
  { hex: "#8A1C2B", name: "Maroon" },
  { hex: "#2F6B3A", name: "Forest Green" },
  { hex: "#5B7DB1", name: "Royal Blue" },
  { hex: "#C8BFAE", name: "Khaki" },
];

const LOGO_METHODS = [
  { title: "Embroidery", text: "Stitched logos for jackets, polos and caps. Durable and premium." },
  { title: "Screen Print", text: "Crisp multi-color prints for large runs and team names." },
  { title: "Sublimation", text: "Full-color, all-over designs for sportswear and racing jackets." },
  { title: "Woven Patch", text: "Woven badges and patches for corporate and institutional wear." },
];

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

function SectionHeading({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#F3E7C6] text-[#9C7521]">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-[#3C567F]">{text}</p>
      </div>
    </div>
  );
}

export default function CapabilitiesPage() {
  return (
    <MjicPageShell
      eyebrow="Customization Capabilities"
      title="Customize every detail, backed by MJIC's production strength"
      intro="From fabric and color to logos, sizing and packaging, MJIC handles the full customization process for bulk jackets, uniforms and branded apparel."
    >
      <section className="mb-16">
        <SectionHeading icon={Palette} title="Fabric" text="Choose the fabric that fits your use case and climate." />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {FABRICS.map((fabric) => (
            <div key={fabric.name} className="text-center">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-[#0B1E3D]/10">
                <Image
                  src={fabric.src}
                  alt={`${fabric.name} fabric swatch`}
                  fill
                  sizes="(min-width:1024px) 16vw, (min-width:640px) 33vw, 50vw"
                  className="object-cover"
                />
              </div>
              <p className="mt-2 text-sm font-medium">{fabric.name}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16">
        <SectionHeading icon={Palette} title="Colors" text="Standard colorways shown below. Any shade can be matched to your approved shade card." />
        <div className="grid grid-cols-4 gap-4 sm:grid-cols-8">
          {COLORS.map((color) => (
            <div key={color.name} className="text-center">
              <div
                className="mx-auto aspect-square w-full rounded-full border border-[#0B1E3D]/15"
                style={{ backgroundColor: color.hex }}
                aria-hidden="true"
              />
              <p className="mt-2 text-xs font-medium">{color.name}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16">
        <SectionHeading icon={Stamp} title="Logo Customization" text="Four decoration methods, selected by fabric, detail level and quantity." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOGO_METHODS.map((method) => (
            <div key={method.title} className="rounded-lg border border-[#0B1E3D]/10 p-5">
              <h3 className="font-bold">{method.title}</h3>
              <p className="mt-2 text-sm text-[#3C567F]">{method.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-16 grid gap-8 lg:grid-cols-2">
        <div>
          <SectionHeading icon={Ruler} title="Sizing" text="Standard size charts for men, women and youth fits." />
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[#0B1E3D]/10 bg-white">
            <Image
              src="/images/size-chart/polo%20shirt%20size%20chart.jpg"
              alt="MJIC polo shirt size chart"
              fill
              sizes="(min-width:1024px) 50vw, 100vw"
              className="object-contain p-2"
            />
          </div>
        </div>
        <div>
          <SectionHeading icon={Tag} title="Custom Labels" text="Neck labels, care labels and size tags printed to your specification." />
          <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-[#0B1E3D]/10 bg-[#EEF1F6] p-6">
            <div className="w-full max-w-xs rounded-md bg-white p-5 text-center shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#9C7521]">Your Brand</p>
              <p className="mt-2 text-2xl font-bold tracking-widest text-[#0B1E3D]">MJIC</p>
              <p className="mt-3 border-t border-[#0B1E3D]/10 pt-3 text-xs text-[#3C567F]">
                Size M · 100% Polyester · Care instructions
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-16 grid gap-8 lg:grid-cols-2 lg:items-center">
        <div>
          <SectionHeading icon={Leaf} title="Eco-Packaging" text="Recyclable and minimal packaging options for every bulk shipment." />
          <ul className="space-y-3 text-sm text-[#3C567F]">
            <li>Recyclable poly bags and kraft cartons</li>
            <li>Size and department labels on each carton</li>
            <li>Packing list included with every shipment</li>
          </ul>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg">
          <Image
            src="/images/production%20tahian/9.jpg"
            alt="MJIC garments packed for shipment"
            fill
            sizes="(min-width:1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-2xl font-bold">Why choose MJIC</h2>
        <p className="mb-8 text-sm text-[#3C567F]">Six advantages behind every order we produce.</p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ADVANTAGES.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="rounded-lg border border-[#0B1E3D]/10 bg-white p-6">
                <Icon className="mb-4 h-7 w-7 text-[#B8912F]" aria-hidden="true" />
                <h3 className="font-bold">{item.title}</h3>
                <p className="mt-2 text-sm text-[#3C567F]">{item.text}</p>
              </div>
            );
          })}
        </div>
      </section>
    </MjicPageShell>
  );
}
