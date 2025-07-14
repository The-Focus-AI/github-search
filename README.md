# GitHub Repository Analyzer

This tool allows you to search for GitHub repositories by keyword, clone them, and analyze their file structure for specific patterns (such as Cursor rules). It generates a Markdown report summarizing the findings.

## Usage

Run the script with [tsx](https://github.com/esbuild/tsx) or Node.js:

```sh
tsx github-analyzer.ts <search-query> [file-patterns...] [options]
```

### Examples

```sh
tsx github-analyzer.ts "dotfiles" "*.zsh" "*.bash" --limit 15
tsx github-analyzer.ts "claude.md" --limit 10
tsx github-analyzer.ts "cursor rules" ".cursor/rules" "cursor-rules" --limit 20
```

### Options
- `--limit <number>`: Number of repositories to analyze (default: 10)
- `--help`: Show usage instructions

## What It Does
- Searches GitHub for repositories matching your query (using the GitHub CLI `gh`)
- Clones each repository into a temporary directory
- Recursively scans files, looking for matches to your file patterns (supports globs like `*.mdc` or directory names)
- Analyzes file types, structure, and special files (like `README.md`, `package.json`)
- Generates a Markdown report summarizing the results
- Prints the location of the temporary directory where all repositories are checked out

## Where Are the Files?

After running, the script prints the path to the temporary directory (e.g., `/var/folders/.../T/github-analysis-<timestamp>`). All cloned repositories are stored there, in subdirectories named `<owner>-<repo>`. The files remain available for further inspection until you manually delete them or your system cleans up the temp directory.

## Requirements
- Node.js (18+ recommended)
- [tsx](https://github.com/esbuild/tsx) (for running TypeScript directly)
- [GitHub CLI (`gh`)](https://cli.github.com/) (must be authenticated)

## Development Notes
- The script uses Node.js built-in modules (`fs`, `path`, `os`, `child_process`).
- If you see TypeScript errors about missing types, install Node types:
  ```sh
  npm install --save-dev @types/node
  ```
- The script is designed for CLI use, but you can also import and use the `GitHubRepoAnalyzer` class programmatically.

---

Created on 2025-07-14
