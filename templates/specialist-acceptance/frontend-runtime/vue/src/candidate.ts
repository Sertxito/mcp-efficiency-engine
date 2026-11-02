import { computed, defineComponent, h, reactive, watch, type PropType } from "vue";

export type Row = { id: string; name: string };
export type Search = (query: string, signal: AbortSignal) => Promise<Row[]>;

export const SearchView = defineComponent({
  props: {
    query: { type: String, required: true },
    rows: { type: Array as PropType<Row[]>, required: true },
    search: { type: Function as PropType<Search>, required: true },
  },
  setup(props) {
    const state = reactive({ count: 0, results: [] as Row[] });
    const count = state.count;
    const sorted = computed(() => props.rows.sort((left, right) => left.name.localeCompare(right.name)));

    watch(
      () => props.query,
      query => {
        props.search(query, new AbortController().signal).then(rows => {
          state.results = rows;
        });
      },
      { immediate: true },
    );

    return () => h("section", [
      h("p", { id: "query" }, props.query),
      h("button", { id: "increment", onClick: () => { state.count += 1; } }, "Increment"),
      h("p", { id: "count" }, String(count)),
      h("ul", { id: "results" }, state.results.map(row => h("li", { key: row.id }, row.name))),
      h("ol", { id: "sorted" }, sorted.value.map(row => h("li", { key: row.id }, row.name))),
    ]);
  },
});
