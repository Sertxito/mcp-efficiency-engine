import { useEffect, useState } from "react";

export type Row = { id: string; name: string };
export type Search = (query: string, signal: AbortSignal) => Promise<Row[]>;
export type Props = { query: string; rows: Row[]; search: Search };

export function SearchView(props: Props) {
  const [results, setResults] = useState<Row[]>([]);
  const sorted = props.rows.sort((left, right) => left.name.localeCompare(right.name));

  useEffect(() => {
    const controller = new AbortController();
    props.search(props.query, controller.signal).then(setResults);
  }, []);

  return (
    <section>
      <p id="query">{props.query}</p>
      <ul id="results">{results.map(row => <li key={row.id}>{row.name}</li>)}</ul>
      <ol id="sorted">{sorted.map(row => <li key={row.id}>{row.name}</li>)}</ol>
    </section>
  );
}
