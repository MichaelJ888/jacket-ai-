import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  CheckCircle,
  ClipboardCheck,
  Layers,
  Package,
  PenTool,
  Scissors,
  SearchCheck,
  Shirt,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import MjicPageShell from "../_components/MjicPageShell";

export const metadata: Metadata = {
  title: "Production Workflow | MJIC",
  description:
    "How Michael Jeffrey International Corporation takes a bulk jacket, uniform or branded order from requirements to delivery.",
};

type Stage = {
  title: string;
  icon: LucideIcon;
  summary: string;
  points: string[];
  photo?: { src: string; alt: string };
  swatches?: { src: string; name: string }[];
};

const STAGES: Stage[] = [
  {
    title: "Requirements",
    icon: ClipboardCheck,
    summary: "We confirm quantity, sizes, deadline and budget before any work starts.",
    points: [
      "Minimum order of 20 pieces per design",
      "Headcount and size breakdown per department",
      "Target delivery date and delivery address",
    ],
  },
  {
    title: "Design",
    icon: PenTool,
    summary: "Logos, color blocks and placements are drawn into a production-ready layout.",
    points: [
      "Logo artwork checked for embroidery or print suitability",
      "Placement and color approval sent to the client",
      "Size chart and pattern set for the chosen cut",
    ],
    photo: {
      src: "/images/size-chart/polo%20shirt%20size%20chart.jpg",
      alt: "MJIC polo shirt size chart",
    },
  },
  {
    title: "Material",
    icon: Layers,
    summary: "Fabric is sourced and matched to the approved color and performance class.",
    points: [
      "Shell, lining and rib trims sourced per order",
      "Color matching against the approved shade card",
      "Incoming fabric checked before cutting",
    ],
    swatches: [
      { src: "/images/fabrics/honeycomb-pique.svg", name: "Honeycomb / Pique" },
      { src: "/images/fabrics/oxford.svg", name: "Oxford / Broadcloth" },
      { src: "/images/fabrics/diamond-ripstop.svg", name: "Diamond Ripstop" },
    ],
  },
  {
    title: "Sample",
    icon: Shirt,
    summary: "A pre-production sample is made so the client can approve fit, logo and finish.",
    points: [
      "Fit and measurement check on a sample piece",
      "Client comments applied before mass production",
      "Approved sample kept as the production reference",
    ],
    photo: {
      src: "/images/hospital-uniforms/viber_image_2025-08-12_08-26-56-551.jpg",
      alt: "MJIC uniform sample on a display form",
    },
  },
  {
    title: "Sewing",
    icon: Scissors,
    summary: "Cutting and sewing run in batches so every line follows the approved sample.",
    points: [
      "Cutting by size and batch number",
      "Embroidery and print applied per approved placement",
      "Line supervisors check output each shift",
    ],
    photo: {
      src: "/images/production%20tahian/1.jpg",
      alt: "MJIC sewing line in production",
    },
  },
  {
    title: "Inspection",
    icon: SearchCheck,
    summary: "Each batch is checked for stitching, logo position, measurements and finish.",
    points: [
      "In-line checks during sewing",
      "Final inspection of every batch before packing",
      "Defective pieces are repaired or replaced",
    ],
    photo: {
      src: "/images/production%20tahian/8.jpg",
      alt: "MJIC garment batch under inspection",
    },
  },
  {
    title: "Packing",
    icon: Package,
    summary: "Pieces are folded, bagged and labeled by size, department and carton.",
    points: [
      "Size and department labels on every carton",
      "Eco-friendly packaging options available",
      "Packing list issued with each shipment",
    ],
    photo: {
      src: "/images/production%20tahian/9.jpg",
      alt: "MJIC garments packed for shipment",
    },
  },
  {
    title: "Delivery",
    icon: Truck,
    summary:
      "Finished orders are delivered on the agreed schedule, with final payment on receipt.",
    points: [
      "Delivery to the client's site or office",
      "Balance settled on delivery per the agreed terms",
      "After-sales support for reorders and replacements",
    ],
  },
];

export default function ProductionWorkflowPage() {
  return (
    <MjicPageShell
      eyebrow="MJIC Production Workflow"
      title="From requirement to delivery, in eight controlled steps"
      intro="Every bulk order at MJIC follows the same production workflow, so volume, quality and delivery dates stay predictable from the first brief to the final carton."
    >
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <li
              key={stage.title}
              className="flex flex-col overflow-hidden rounded-lg border border-[#0B1E3D]/10 bg-white"
            >
              {stage.photo ? (
                <div className="relative aspect-[4/3] bg-[#EEF1F6]">
                  <Image
                    src={stage.photo.src}
                    alt={stage.photo.alt}
                    fill
                    sizes="(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#0B1E3D] to-[#132A50]">
                  <Icon className="h-14 w-14 text-[#C9A03C]" aria-hidden="true" />
                </div>
              )}

              <div className="flex flex-1 flex-col p-5">
                <div className="mb-2 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F3E7C6] text-sm font-bold text-[#9C7521]">
                    {index + 1}
                  </span>
                  <h2 className="text-lg font-bold">{stage.title}</h2>
                </div>
                <p className="mb-4 text-sm text-[#3C567F]">{stage.summary}</p>

                {stage.swatches && (
                  <div className="mb-4 flex gap-2">
                    {stage.swatches.map((swatch) => (
                      <div key={swatch.name} className="flex-1">
                        <div className="relative aspect-square overflow-hidden rounded-md border border-[#0B1E3D]/10">
                          <Image
                            src={swatch.src}
                            alt={`${swatch.name} fabric swatch`}
                            fill
                            sizes="120px"
                            className="object-cover"
                          />
                        </div>
                        <p className="mt-1 text-[10px] leading-tight text-[#3C567F]">
                          {swatch.name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <ul className="mt-auto space-y-2 text-sm">
                  {stage.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <CheckCircle
                        className="mt-0.5 h-4 w-4 shrink-0 text-[#B8912F]"
                        aria-hidden="true"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-12 flex flex-col items-start justify-between gap-4 rounded-lg bg-[#F3E7C6]/60 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="font-bold">Ready to start your bulk order?</p>
          <p className="text-sm text-[#3C567F]">
            Send your design and quantities and our sales team will issue a formal quotation.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center rounded-md bg-[#B8912F] px-5 py-3 text-sm font-semibold text-[#0B1E3D] hover:bg-[#9C7521] hover:text-white"
        >
          Request a Quotation
        </Link>
      </div>
    </MjicPageShell>
  );
}
