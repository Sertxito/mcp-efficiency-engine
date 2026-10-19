Apply the repository's existing conventions before introducing new ones.

1. Inspect nearby code, `.editorconfig`, formatter settings, analyzers, and
   project checks; treat established project conventions as authoritative.
2. Choose names that communicate domain intent and use the language's
   established casing and API conventions.
3. Prefer cohesive units, explicit control flow and errors, and the smallest
   abstraction that makes the behavior clearer.
4. Keep the change scoped; avoid unrelated renames, speculative abstractions,
   and style-only rewrites.
5. Run the existing formatter, analyzers, and focused tests when available.
   Report which checks actually ran; do not claim style compliance without
   executable evidence.

Do not treat subjective preferences as universal rules or override the
repository's documented conventions without an explicit decision.
