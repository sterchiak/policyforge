export default function Card({
  title,
  children,
  footer,
}: {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      {title && <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>}
      <div>{children}</div>
      {footer ? <div className="mt-4 border-t pt-3 text-sm text-gray-600">{footer}</div> : null}
    </section>
  );
}
