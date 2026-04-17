import Link from "next/link";

export default function CheckInIndex() {
  return (
    <main className="mx-auto max-w-2xl text-center">
      <h1 className="text-xl font-semibold">StudioFlow Check-in</h1>
      <p className="mt-3 text-sm text-white/50">
        Scan the QR code for your class to check in. You can also reach the
        check-in page directly from the class URL.
      </p>
      <p className="mt-8 text-xs text-white/30">
        Running live QA? Start at{" "}
        <Link href="/qa" className="underline-offset-2 hover:text-white/70 hover:underline">
          /qa
        </Link>
        {" "}for the deterministic fixture matrix.
      </p>
    </main>
  );
}
