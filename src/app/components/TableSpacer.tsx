/** Rows of a windowed table not drawn, as the height they would take. */
export function TableSpacer({
  height,
  columns,
}: {
  readonly height: number;
  readonly columns: number;
}) {
  return (
    <tr className="wst__spacer" aria-hidden="true" style={{ height }}>
      <td colSpan={columns} />
    </tr>
  );
}
