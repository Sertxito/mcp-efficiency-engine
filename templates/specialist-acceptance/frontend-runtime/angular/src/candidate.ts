import { CommonModule } from "@angular/common";
import { Component, computed, effect, inject, Input, signal, InjectionToken } from "@angular/core";

export type Row = { id: string; name: string };
export type Search = (query: string, signal: AbortSignal) => Promise<Row[]>;
export const SEARCH_API = new InjectionToken<{ search: Search }>("SEARCH_API");

@Component({
  selector: "mcpee-search",
  standalone: true,
  imports: [CommonModule],
  template: `
    <section>
      <p id="query">{{ queryState() ?? '' }}</p>
      <button id="count" (click)="increment()">{{ count() }}</button>
      <ul id="results"><li *ngFor="let row of results()">{{ row.name }}</li></ul>
      <ol id="sorted"><li *ngFor="let row of sortedRows()">{{ row.name }}</li></ol>
    </section>
  `,
})
export class SearchComponent {
  readonly queryState = signal<string | null>(null);
  readonly rowsState = signal<Row[]>([]);
  readonly count = signal(0);
  readonly results = signal<Row[]>([]);
  readonly sortedRows = computed(() => this.rowsState().sort((left, right) => left.name.localeCompare(right.name)));
  private readonly api = inject(SEARCH_API);

  @Input()
  set query(value: string) {
    this.queryState.set(value);
  }

  @Input()
  set rows(value: Row[]) {
    this.rowsState.set(value);
  }

  constructor() {
    effect(() => {
      const query = this.queryState();
      if (query !== null) {
        this.api.search(query, new AbortController().signal).then(rows => this.results.set(rows));
      }
    });
  }

  increment(): void {
    this.count.update(value => value + 1);
  }
}
