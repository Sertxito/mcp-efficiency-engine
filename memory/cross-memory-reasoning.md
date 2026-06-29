# Cross Memory Reasoning

Used when a query touches multiple domains.

Example:

- code + SLA
- DBA + architecture
- docs + business

Process:

1. Query each memory
2. Extract relevant signals
3. Merge into unified response
4. If source is code, resolve symbols via CodeGraph before broad file reads
5. Register reusable pattern in code-memory feedback loop