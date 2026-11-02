# AGENTS.md

## Principles

* Assume nothing is legacy. Do not write code that preserves in case of legacy clients.
* Do not run unnecessary tests. Assume that the person prompting will check it.
* Building is unnecessary. Do not do it.
* All of the code must be human readable.
* Prefer arrow functions over function keyword.
* Never hoist functions.
* Keep future proofing in mind.
* Keep utility functions in a separate file.
* Keep code modular by separating unrelated responsibilities.
* Keep CSS and styling simple and intentional. Avoid unnecessary visual complexity.
* Keep styling close to the component when it is component-specific. Move shared or large styling into CSS files.
* Do not start development servers or manually test the application. Assume the person prompting will verify changes.
* Keep CSS well-formatted.
* Never use .then(). Prefer async functions.

## Hard Rules

- Do not implement anything I didn't ask for without checking with me first.
- Make the minimum change that solves the request. No speculative features, abstractions, configurability, or unrelated cleanup.
- Every changed line should trace back to the user request.
- Unless otherwise specified by the user, do not add compatibility shims, legacy aliases, migrations, old-shape detection or rejection, fallback paths, dual behavior, or stale overrides. 