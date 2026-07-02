import {
  defineComponent,
  h,
  ref,
  computed,
  watch,
  provide,
  inject,
  onScopeDispose,
  type PropType,
  type InjectionKey,
  type Ref,
  type ComputedRef,
  type VNode,
} from "vue";
import {
  fetchSearch,
  buildFilter,
  toggleRefinement as toggleRef,
  type SearchQuery,
  type SearchApiResponse,
  type SearchMode,
} from "./react-core.js";
import type { SearchResult, FacetValue } from "./types.js";

/**
 * Vue 3 adapter for PragmaSearch — a `usePragmaSearch` composable plus components
 * (`<PragmaSearch>`, `<SearchBox>`, `<RefinementList>`, `<Hits>`, `<Pagination>`,
 * `<ClearRefinements>`, `<PoweredBy>`), built with render functions (no SFC
 * compiler). Emits the same `.ps-*` classes as the widget, so the widget CSS
 * themes it. Vue is an optional peer dependency. Talks to `/api/search`.
 */

export type { SearchQuery, SearchApiResponse, SearchMode } from "./react-core.js";
export { buildSearchParams, searchUrl, fetchSearch } from "./react-core.js";

export interface UsePragmaSearchOptions {
  endpoint?: string;
  initialQuery?: string;
  hitsPerPage?: number;
  mode?: SearchMode;
  typo?: boolean;
  facets?: string[];
  highlight?: boolean;
  debounceMs?: number;
}

export interface PragmaSearchState {
  query: Ref<string>;
  setQuery: (q: string) => void;
  results: ComputedRef<SearchResult[]>;
  total: ComputedRef<number>;
  facets: ComputedRef<Record<string, FacetValue[]>>;
  refinements: Ref<Record<string, string[]>>;
  toggleRefinement: (field: string, value: string) => void;
  clearRefinements: () => void;
  isRefined: (field: string, value: string) => boolean;
  page: Ref<number>;
  setPage: (p: number) => void;
  pageCount: ComputedRef<number>;
  hitsPerPage: number;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
}

/** Headless search composable. Owns query, refinements, pagination; debounces + aborts stale fetches. */
export function usePragmaSearch(opts: UsePragmaSearchOptions = {}): PragmaSearchState {
  const {
    endpoint = "",
    initialQuery = "",
    hitsPerPage = 12,
    mode = "hybrid",
    typo = true,
    facets,
    highlight = true,
    debounceMs = 180,
  } = opts;

  const query = ref(initialQuery);
  const refinements = ref<Record<string, string[]>>({});
  const page = ref(0);
  const resp = ref<SearchApiResponse | null>(null);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  const setQuery = (q: string): void => {
    query.value = q;
    page.value = 0;
  };
  const toggleRefinement = (field: string, value: string): void => {
    refinements.value = toggleRef(refinements.value, field, value);
    page.value = 0;
  };
  const clearRefinements = (): void => {
    refinements.value = {};
    page.value = 0;
  };
  const isRefined = (field: string, value: string): boolean =>
    (refinements.value[field] ?? []).includes(value);

  const filter = computed(() => buildFilter(refinements.value));
  const results = computed(() => resp.value?.results ?? []);
  const total = computed(() => resp.value?.total ?? 0);
  const facetsData = computed(() => resp.value?.facets ?? {});
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / hitsPerPage)));

  let ctrl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    [query, filter, page],
    () => {
      const q = query.value.trim();
      if (!q && Object.keys(filter.value).length === 0) {
        resp.value = null;
        loading.value = false;
        error.value = null;
        return;
      }
      ctrl?.abort();
      if (timer) clearTimeout(timer);
      loading.value = true;
      const input: SearchQuery = {
        query: q,
        hitsPerPage,
        offset: page.value * hitsPerPage,
        mode,
        typo,
        facets,
        filter: filter.value,
        highlight,
      };
      const c = new AbortController();
      ctrl = c;
      timer = setTimeout(() => {
        fetchSearch(endpoint, input, c.signal)
          .then((r) => {
            resp.value = r;
            error.value = null;
          })
          .catch((e: unknown) => {
            if ((e as Error).name === "AbortError") return;
            error.value = e as Error;
            resp.value = null;
          })
          .finally(() => {
            loading.value = false;
          });
      }, debounceMs);
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    ctrl?.abort();
    if (timer) clearTimeout(timer);
  });

  return {
    query,
    setQuery,
    results,
    total,
    facets: facetsData,
    refinements,
    toggleRefinement,
    clearRefinements,
    isRefined,
    page,
    setPage: (p: number) => {
      page.value = p;
    },
    pageCount,
    hitsPerPage,
    loading,
    error,
  };
}

const KEY: InjectionKey<PragmaSearchState> = Symbol("pragmasearch");

function useCtx(): PragmaSearchState {
  const c = inject(KEY, null);
  if (!c) throw new Error("PragmaSearch: components must be used inside <PragmaSearch>.");
  return c;
}

/** Access the shared search state from a descendant of `<PragmaSearch>`. */
export function usePragmaSearchContext(): PragmaSearchState {
  return useCtx();
}

export const PragmaSearch = defineComponent({
  name: "PragmaSearch",
  props: {
    endpoint: { type: String, default: "" },
    facets: { type: Array as PropType<string[]>, default: undefined },
    hitsPerPage: { type: Number, default: 12 },
    mode: { type: String as PropType<SearchMode>, default: "hybrid" },
    typo: { type: Boolean, default: true },
    highlight: { type: Boolean, default: true },
    initialQuery: { type: String, default: "" },
    debounceMs: { type: Number, default: 180 },
  },
  setup(props, { slots }) {
    const state = usePragmaSearch({
      endpoint: props.endpoint,
      facets: props.facets,
      hitsPerPage: props.hitsPerPage,
      mode: props.mode,
      typo: props.typo,
      highlight: props.highlight,
      initialQuery: props.initialQuery,
      debounceMs: props.debounceMs,
    });
    provide(KEY, state);
    return () => h("div", { class: "ps-root" }, slots.default?.());
  },
});

export const SearchBox = defineComponent({
  name: "SearchBox",
  props: { placeholder: { type: String, default: "Search…" } },
  setup(props) {
    const s = useCtx();
    return () =>
      h("div", { class: "ps-searchbar" }, [
        h(
          "svg",
          {
            class: "ps-icon",
            width: "18",
            height: "18",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "2",
            "stroke-linecap": "round",
            "aria-hidden": "true",
          },
          [h("circle", { cx: "11", cy: "11", r: "7" }), h("path", { d: "m21 21-4.3-4.3" })],
        ),
        h("input", {
          class: "ps-input",
          type: "text",
          value: s.query.value,
          placeholder: props.placeholder,
          autocomplete: "off",
          "aria-label": "Search",
          onInput: (e: Event) => s.setQuery((e.target as HTMLInputElement).value),
        }),
      ]);
  },
});

function defaultHit(hit: SearchResult): VNode {
  const p = hit.product as Record<string, unknown>;
  const titleHtml = hit.highlights?.title;
  return h("div", { class: "ps-body" }, [
    h(
      "div",
      { class: "ps-title" },
      // Server output is HTML-escaped then <mark>-wrapped, so innerHTML is safe.
      titleHtml ? [h("span", { innerHTML: titleHtml })] : String(p.title ?? ""),
    ),
    h("div", { class: "ps-meta" }, [
      p.category != null ? h("span", { class: "ps-cat" }, String(p.category)) : null,
      p.price != null ? h("span", { class: "ps-price" }, String(p.price)) : null,
    ]),
  ]);
}

export const Hits = defineComponent({
  name: "Hits",
  props: { emptyText: { type: String, default: "No results." } },
  setup(props, { slots }) {
    const s = useCtx();
    return () => {
      const results = s.results.value;
      if (!results.length) {
        const msg = s.loading.value || !s.query.value.trim() ? "" : s.total.value === 0 ? props.emptyText : "";
        return h("div", { class: "ps-empty" }, msg);
      }
      return h(
        "div",
        { class: "ps-hits" },
        results.map((hit) =>
          h("div", { class: "ps-hit", key: String(hit.id) }, slots.hit ? slots.hit({ hit }) : defaultHit(hit)),
        ),
      );
    };
  },
});

export const RefinementList = defineComponent({
  name: "RefinementList",
  props: { attribute: { type: String, required: true }, title: { type: String, default: undefined } },
  setup(props) {
    const s = useCtx();
    return () => {
      const values = s.facets.value[props.attribute] ?? [];
      if (!values.length) return null;
      return h("div", { class: "ps-fgroup" }, [
        h("h4", props.title ?? props.attribute),
        ...values.map((f) =>
          h("label", { class: "ps-fitem", key: f.value }, [
            h("input", {
              type: "checkbox",
              checked: s.isRefined(props.attribute, f.value),
              onChange: () => s.toggleRefinement(props.attribute, f.value),
            }),
            h("span", f.value),
            h("span", { class: "ps-fc" }, String(f.count)),
          ]),
        ),
      ]);
    };
  },
});

export const ClearRefinements = defineComponent({
  name: "ClearRefinements",
  setup(_, { slots }) {
    const s = useCtx();
    return () =>
      Object.keys(s.refinements.value).length
        ? h("button", { class: "ps-clear", type: "button", onClick: () => s.clearRefinements() }, slots.default?.() ?? "Clear filters")
        : null;
  },
});

export const Pagination = defineComponent({
  name: "Pagination",
  setup() {
    const s = useCtx();
    return () => {
      if (s.total.value <= s.hitsPerPage) return null;
      const from = s.page.value * s.hitsPerPage + 1;
      const to = Math.min(s.total.value, (s.page.value + 1) * s.hitsPerPage);
      return h("div", { class: "ps-pager" }, [
        h(
          "button",
          {
            class: "ps-prev",
            type: "button",
            disabled: s.page.value <= 0,
            onClick: () => s.setPage(Math.max(0, s.page.value - 1)),
          },
          "← Prev",
        ),
        h("span", { class: "ps-info" }, `${from}–${to} of ${s.total.value}`),
        h(
          "button",
          {
            class: "ps-next",
            type: "button",
            disabled: s.page.value >= s.pageCount.value - 1,
            onClick: () => s.setPage(s.page.value + 1),
          },
          "Next →",
        ),
      ]);
    };
  },
});

export const PoweredBy = defineComponent({
  name: "PoweredBy",
  setup() {
    return () =>
      h("div", { class: "ps-poweredby" }, [
        "powered by ",
        h(
          "a",
          { href: "https://github.com/wemaxie/PragmaSearch", target: "_blank", rel: "noopener noreferrer" },
          "PragmaSearch",
        ),
      ]);
  },
});
