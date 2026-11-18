import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 px-4 text-center">
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="mb-6 opacity-80">That page does not exist or has moved.</p>
      <Link href="/" className="rounded-lg bg-blue-600 px-4 py-2 text-white inline-block">Go home</Link>
    </div>
  );
}
