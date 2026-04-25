import Link from 'next/link';

interface Props {
  href: string;
  label?: string;
}

export default function BackButton({ href, label = 'Back' }: Props) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 text-sm text-gray-400 transition hover:text-white"
    >
      ← {label}
    </Link>
  );
}
