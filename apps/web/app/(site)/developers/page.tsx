import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/site/icons";
import { Card, Chip, Container, CtaBand, Eyebrow, IconTile, SectionHeading } from "@/components/site/ui";
import { CONNECTOR_SPEC_URL, CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Connector API",
  description: "Connect any custom-built store with the Store Ops connector API: twelve JSON endpoints over HTTPS, described in OpenAPI 3.1.",
};

const ENDPOINTS: [string, string, string, string][] = [
  ["GET", "/capabilities", "What your store supports: orders, inventory, coupons and reviews, and their .write forms.", "—"],
  ["GET", "/orders", "Orders, newest first. Filters: status, createdFrom, createdTo, overdue, query; paged with limit and cursor.", "orders"],
  ["GET", "/orders/{id}", "One order in full: line items, totals, customer contact, note and promised date.", "orders"],
  ["POST", "/orders/{id}/status", "Change an order's status. Setting the current status changes nothing; cancelled and refunded orders cannot change.", "orders.write"],
  ["GET", "/products", "Products with their variants, price and stock. Filters: query, lowStockThreshold.", "inventory"],
  ["GET", "/variants/{id}/product", "The product a variant belongs to.", "inventory"],
  ["PUT", "/variants/{id}/stock", "Set a variant's absolute stock level.", "inventory.write"],
  ["GET", "/coupons", "Every coupon, with its discount, usage, dates and whether it is active.", "coupons"],
  ["POST", "/coupons", "Create a coupon. Codes are case-insensitive; an existing code answers 409.", "coupons.write"],
  ["GET", "/reviews", "Reviews, newest first. Filters: minRating, maxRating, unreplied, since, productId.", "reviews"],
  ["POST", "/reviews/{id}/reply", "Post the store's public reply. A review takes one reply; a second answers 409.", "reviews.write"],
  ["GET", "/sales-summary", "Totals for orders created between from (inclusive) and to (exclusive), excluding cancelled and refunded, with the top 5 products.", "orders"],
];

const CONVENTIONS: { icon: IconName; title: string; body: string; code: string }[] = [
  { icon: "lock", title: "Authentication", body: "Every request carries the API key the owner pastes when connecting.", code: "Authorization: Bearer <key>" },
  { icon: "wallet", title: "Money in minor units", body: "Integers in the currency's minor unit (paise for INR), with an ISO 4217 code. No floats.", code: '{ "amount": 1250000, "currency": "INR" }' },
  { icon: "clock", title: "Time in UTC", body: "Timestamps are ISO 8601 in UTC with a Z suffix. Time ranges are [from, to).", code: "2026-10-21T10:14:22Z" },
  { icon: "log", title: "Cursor paging", body: "Lists return items and an opaque nextCursor, null on the last page. Every item appears exactly once.", code: '{ "items": [...], "nextCursor": "25" }' },
  { icon: "sliders", title: "Declare what you support", body: "Anything your store does not support answers 501, and the agent is never offered it.", code: '{ "capabilities": ["orders", "inventory"] }' },
  { icon: "info", title: "One error shape", body: "NOT_FOUND 404, CONFLICT 409, VALIDATION 422, UNSUPPORTED 501, AUTH 401, RATE_LIMITED 429 with Retry-After.", code: '{ "error": { "code": "VALIDATION", "message": "..." } }' },
];

const EXAMPLE = `{
  "items": [
    {
      "id": "ord_8f192b4",
      "number": "RTS-1042",
      "status": "processing",
      "platformStatus": "stitching",
      "customer": {
        "id": "cus_31",
        "name": "Meera Sharma",
        "email": "meera.sharma@example.com",
        "phone": null
      },
      "lineItems": [
        {
          "productId": "prd_12",
          "variantId": "var_12_m",
          "title": "Silk Anarkali Suit (M)",
          "quantity": 1,
          "unitPrice": { "amount": 1250000, "currency": "INR" }
        }
      ],
      "total": { "amount": 1250000, "currency": "INR" },
      "note": "Need it before the wedding.",
      "createdAt": "2026-10-14T10:14:22.000Z",
      "updatedAt": "2026-10-15T08:02:10.000Z",
      "promisedAt": "2026-10-21T18:29:59.000Z"
    }
  ],
  "nextCursor": "1"
}`;

const METHOD_TONE: Record<string, "green" | "teal" | "ink"> = { GET: "green", POST: "teal", PUT: "ink" };

export default function DevelopersPage() {
  return (
    <>
      <section className="border-b border-gray-200 bg-gradient-to-b from-emerald-50/70 to-white">
        <Container className="py-16 lg:py-20">
          <Eyebrow>OpenAPI 3.1 · REST and JSON</Eyebrow>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
            Connect any store with the <span className="text-green-600">Store Ops</span> connector API.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-gray-500">
            Twelve JSON endpoints over HTTPS. Implement them on your store, and the owner connects it as a custom store with its base URL and an API key.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={CONNECTOR_SPEC_URL} className="inline-flex items-center gap-2 rounded-[10px] bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700">
              Download the OpenAPI spec <Icon name="arrowRight" className="h-4 w-4" />
            </a>
            <a href="#conventions" className="inline-flex items-center rounded-[10px] border-2 border-ink bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-gray-50">
              Read the conventions
            </a>
          </div>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="py-20">
          <SectionHeading eyebrow="Reference" title="The endpoints" lead="Implement what your store supports and declare it in /capabilities. A write capability needs its read capability." />
          <div className="mt-10 overflow-x-auto rounded-[10px] border border-gray-200 shadow-sm">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Method</th>
                  <th className="px-5 py-3 font-medium">Path</th>
                  <th className="px-5 py-3 font-medium">What it does</th>
                  <th className="px-5 py-3 font-medium">Capability</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([method, path, what, cap]) => (
                  <tr key={`${method} ${path}`} className="border-t border-gray-100 align-top">
                    <td className="px-5 py-3.5"><Chip tone={METHOD_TONE[method]}>{method}</Chip></td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-ink">{path}</td>
                    <td className="px-5 py-3.5 text-gray-600">{what}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-mono text-xs text-gray-500">{cap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section id="conventions" className="scroll-mt-20 border-y border-gray-200 bg-gray-50">
        <Container className="py-20">
          <SectionHeading eyebrow="Conventions" title="The rules every endpoint follows" lead="The platform checks each of these: a response outside the spec is reported as invalid and the agent does not use it." />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CONVENTIONS.map((c) => (
              <Card key={c.title} className="flex flex-col">
                <IconTile name={c.icon} tone="teal" />
                <h3 className="mt-4 font-semibold text-ink">{c.title}</h3>
                <p className="mt-2 flex-1 text-sm text-gray-500">{c.body}</p>
                <code className="mt-4 block overflow-x-auto rounded-md bg-ink px-3 py-2 font-mono text-xs text-green-300">{c.code}</code>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-white">
        <Container className="grid items-start gap-10 py-20 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Example" title="GET /orders?limit=1" lead="Responses use exactly the shapes in the spec: money in minor units, UTC timestamps, and the normalised order statuses." />
            <ul className="mt-6 space-y-3 text-sm text-gray-700">
              <li><strong className="text-ink">status</strong> is one of pending, processing, ready, shipped, delivered, cancelled, refunded; <strong className="text-ink">platformStatus</strong> keeps your own label.</li>
              <li><strong className="text-ink">promisedAt</strong> is when delivery was promised, or null if your store does not track it. The agent uses it to find late orders.</li>
              <li><strong className="text-ink">amount 1250000</strong> is ₹12,500.00.</li>
            </ul>
          </div>
          <pre className="overflow-x-auto rounded-[10px] bg-ink p-5 font-mono text-xs leading-relaxed text-gray-200 shadow-md">{EXAMPLE}</pre>
        </Container>
      </section>

      <section className="border-t border-gray-200 bg-emerald-50/60">
        <Container className="py-16">
          <div className="flex flex-col gap-4 rounded-[10px] border border-gray-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
            <IconTile name="shield" />
            <div className="flex-1">
              <p className="font-semibold text-ink">Tested, not trusted</p>
              <p className="mt-1 text-sm text-gray-600">
                Every response is validated against the spec before the agent sees it. A sample implementation passes the same conformance test suite as
                the built-in integrations; <Link href="/contact" className="font-medium text-green-700 hover:underline">ask us</Link> for it, or write to{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-green-700 hover:underline">{CONTACT_EMAIL}</a>.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <CtaBand title="Ready to connect your custom store?" lead="Implement the endpoints, then connect it like any other store." />
    </>
  );
}
