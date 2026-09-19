// Pure helpers for CodeExplorer: layout, sorting, summaries and plain-language descriptions.
// No React here so it stays easy to test.

export const NODE_W = 208;
export const GAP_X = 64;
export const ROW_GAP = 10;
export const PAD = 20;
export const H_DIR = 34;
export const H_MOD = 48;

/* ---------- layout: left-to-right tree ---------- */

// root: { id, h, kids: [...] } (kids are only the VISIBLE children).
// Mutates nodes with x, y, depth. Returns everything needed to draw.
export function layoutTree(root) {
  const nodes = [];
  const edges = [];
  let cursor = PAD;
  let maxDepth = 0;

  function place(n, depth, parent) {
    n.depth = depth;
    n.x = PAD + depth * (NODE_W + GAP_X);
    maxDepth = Math.max(maxDepth, depth);
    const kids = n.kids || [];
    if (!kids.length) {
      n.y = cursor;
      cursor += n.h + ROW_GAP;
    } else {
      kids.forEach((k) => place(k, depth + 1, n));
      const a = kids[0];
      const b = kids[kids.length - 1];
      n.y = (a.y + a.h / 2 + b.y + b.h / 2) / 2 - n.h / 2;
    }
    nodes.push(n);
    if (parent) edges.push({ from: parent, to: n });
  }

  place(root, 0, null);
  return {
    nodes,
    edges,
    width: PAD * 2 + maxDepth * (NODE_W + GAP_X) + NODE_W,
    height: Math.max(cursor + PAD - ROW_GAP, 200),
  };
}

// Right edge of parent -> left edge of child, with a vertical spine in the gap.
export function edgePath(p, c) {
  const x1 = p.x + NODE_W;
  const y1 = p.y + p.h / 2;
  const x2 = c.x;
  const y2 = c.y + c.h / 2;
  const xm = x1 + GAP_X / 2;
  return `M${x1},${y1} H${xm} V${y2} H${x2}`;
}

// Dashed arc in the gutter to the left of two nodes in the same column (AI-inferred flow).
export function flowPath(a, b) {
  const x = a.x;
  const ya = a.y + a.h / 2;
  const yb = b.y + b.h / 2;
  const bulge = 22 + Math.min(30, Math.abs(ya - yb) / 5);
  return `M${x},${ya} C${x - bulge},${ya} ${x - bulge},${yb} ${x},${yb}`;
}

/* ---------- folder contents ---------- */

export function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

export function summarize(items) {
  const folders = items.filter((i) => i.type === "dir").length;
  const files = items.length - folders;
  const counts = {};
  for (const it of items) {
    if (it.type === "dir") continue;
    const e = extOf(it.name);
    if (e) counts[e] = (counts[e] || 0) + 1;
  }
  const types = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([e]) => e);
  return { folders, files, types };
}

export function fmtSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------- plain-language descriptions (naming conventions, not AI) ---------- */

const FOLDERS = {
  src: "The main source code of the project.",
  lib: "Reusable library code used across the project.",
  pkg: "Packages other parts of the project (or other projects) import.",
  cmd: "Entry points: one folder per runnable program.",
  internal: "Private packages that only this project may import (a Go convention).",
  app: "Application code: pages, routes or the main program.",
  apps: "Separate applications that live in the same repository.",
  packages: "Separate packages that live in the same repository (a monorepo).",
  core: "The central logic everything else builds on.",
  common: "Helpers and types shared by several parts of the project.",
  shared: "Helpers and types shared by several parts of the project.",
  utils: "Small helper functions.",
  helpers: "Small helper functions.",
  api: "API definitions or route handlers.",
  routes: "URL routes and their handlers.",
  controllers: "Handlers that receive requests and decide what happens.",
  models: "Data models: the shape of the things the app stores.",
  views: "Templates or screens shown to users.",
  components: "Reusable user-interface building blocks.",
  pages: "One file per page or route of the site.",
  hooks: "Reusable stateful logic (React hooks).",
  services: "Business logic and calls to outside services.",
  middleware: "Code that runs on every request before the handler.",
  plugins: "Optional add-ons that extend the project.",
  server: "Back-end code that runs on the server.",
  client: "Front-end code that runs in the browser.",
  cli: "The command-line interface.",
  bin: "Executable scripts or built binaries.",
  scripts: "Helper scripts for building, releasing or maintenance.",
  tools: "Developer tools that support the project.",
  config: "Configuration files and default settings.",
  configs: "Configuration files and default settings.",
  test: "Automated tests.",
  tests: "Automated tests.",
  __tests__: "Automated tests.",
  spec: "Automated tests written as specifications.",
  e2e: "End-to-end tests that drive the whole app.",
  fixtures: "Sample data used by tests.",
  testdata: "Sample data used by tests.",
  mocks: "Fake versions of dependencies used in tests.",
  docs: "Documentation.",
  doc: "Documentation.",
  examples: "Small example programs showing how to use the project.",
  example: "A small example showing how to use the project.",
  samples: "Small example programs showing how to use the project.",
  public: "Static files served as-is (images, icons, fonts).",
  static: "Static files served as-is (images, icons, fonts).",
  assets: "Images, fonts and other media.",
  images: "Image files.",
  img: "Image files.",
  fonts: "Font files.",
  styles: "Stylesheets.",
  css: "Stylesheets.",
  locales: "Translations for different languages.",
  i18n: "Translations for different languages.",
  types: "Type definitions.",
  migrations: "Database changes, applied in order.",
  db: "Database code.",
  deploy: "Files for deploying the project.",
  docker: "Docker files for building and running containers.",
  charts: "Kubernetes Helm charts.",
  vendor: "Copies of third-party code the project depends on.",
  node_modules: "Installed third-party packages (not part of the project itself).",
  dist: "Generated build output (not edited by hand).",
  build: "Generated build output (not edited by hand).",
  ".github": "GitHub settings: automated workflows, issue and PR templates.",
  workflows: "Automated pipelines (CI) that run on GitHub.",
  ".vscode": "Editor settings for VS Code.",
};

const FILES = {
  "package.json": "Node.js project file: name, dependencies and the npm scripts you run.",
  "package-lock.json": "Exact versions of every installed dependency (generated).",
  "yarn.lock": "Exact versions of every installed dependency (generated).",
  "pnpm-lock.yaml": "Exact versions of every installed dependency (generated).",
  "tsconfig.json": "TypeScript compiler settings.",
  "jsconfig.json": "JavaScript editor and path settings.",
  "dockerfile": "Recipe for building the project as a container image.",
  "docker-compose.yml": "Runs several containers together with one command.",
  "docker-compose.yaml": "Runs several containers together with one command.",
  makefile: "Shortcut commands for building, testing and running the project.",
  "go.mod": "Go module file: project name and its dependencies.",
  "go.sum": "Checksums of Go dependencies (generated).",
  "cargo.toml": "Rust project file: name, version and dependencies.",
  "pyproject.toml": "Python project settings and dependencies.",
  "requirements.txt": "List of Python packages to install.",
  "setup.py": "Python packaging script.",
  "pom.xml": "Maven project file for Java.",
  "build.gradle": "Gradle build script for Java or Kotlin.",
  gemfile: "Ruby dependencies.",
  "composer.json": "PHP dependencies.",
  "readme.md": "The project's front page: what it is and how to start.",
  license: "The license: what others may do with this code.",
  "license.md": "The license: what others may do with this code.",
  "contributing.md": "How to contribute. Read this before opening a pull request.",
  "code_of_conduct.md": "Behaviour expected from everyone in the community.",
  "changelog.md": "History of changes between versions.",
  "security.md": "How to report a security problem.",
  ".gitignore": "Files Git should not track.",
  ".env.example": "Template of the environment variables the project needs.",
  ".editorconfig": "Shared editor formatting rules.",
  ".prettierrc": "Code formatting rules (Prettier).",
  ".dockerignore": "Files left out of the Docker image.",
  "codeowners": "Who reviews changes to which files.",
};

const EXT = {
  ".js": "JavaScript source", ".mjs": "JavaScript source", ".cjs": "JavaScript source",
  ".jsx": "React (JavaScript) source", ".ts": "TypeScript source", ".tsx": "React (TypeScript) source",
  ".py": "Python source", ".go": "Go source", ".rs": "Rust source", ".java": "Java source",
  ".kt": "Kotlin source", ".rb": "Ruby source", ".php": "PHP source", ".cs": "C# source",
  ".c": "C source", ".h": "C/C++ header", ".cpp": "C++ source", ".swift": "Swift source",
  ".sh": "Shell script", ".ps1": "PowerShell script", ".sql": "SQL",
  ".md": "Markdown document", ".txt": "Text file", ".rst": "Documentation",
  ".json": "JSON data or settings", ".yml": "YAML settings", ".yaml": "YAML settings",
  ".toml": "TOML settings", ".xml": "XML", ".html": "Web page", ".css": "Stylesheet",
  ".scss": "Stylesheet (Sass)", ".svg": "Vector image", ".png": "Image", ".jpg": "Image",
  ".jpeg": "Image", ".gif": "Image", ".ico": "Icon", ".pdf": "PDF document",
  ".crt": "Certificate", ".pem": "Certificate or key", ".key": "Key file", ".lock": "Lock file",
  ".proto": "Protocol buffer definition", ".env": "Environment variables",
};

const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs", ".c", ".cpp", ".swift"]);

export function describeFolder(name) {
  const hit = FOLDERS[name.toLowerCase()];
  return hit || "A folder. Open it to see what is inside.";
}

// Returns { type: short label, text: sentence }.
export function describeFile(name) {
  const lower = name.toLowerCase();
  const ext = extOf(name);
  const type = EXT[ext] || (ext ? `${ext} file` : "File");
  if (FILES[lower]) return { type, text: FILES[lower] };
  if (/^(next|vite|webpack|rollup|babel|jest|vitest|tailwind|postcss)\.config\./.test(lower))
    return { type, text: "Configuration for a build or test tool." };
  if (/^(\.eslintrc|eslint\.config)/.test(lower)) return { type, text: "Linting rules that keep the code style consistent." };
  if (/(\.test\.|\.spec\.|_test\.|^test_)/.test(lower)) return { type, text: "Automated tests for a nearby piece of code." };
  if (ext === ".crt" || ext === ".pem" || ext === ".key") return { type, text: "A certificate or key, often sample data for tests." };
  if (/^(index|main|app|server)\./.test(lower) && CODE_EXT.has(ext))
    return { type, text: "Likely an entry point: where the code starts running." };
  if (ext === ".md") return { type, text: "A document written in Markdown." };
  if (EXT[ext]) return { type, text: `A ${EXT[ext].toLowerCase()} file.` };
  return { type, text: "A file in this project." };
}

/* ---------- big folders: paging and grouping ---------- */

export const PAGE = 10;       // items shown per folder before "+ N more"
export const PAGE_STEP = 15;  // extra items revealed by each "+ N more" click
const GROUP_MIN = 4;          // a prefix needs at least this many files to become a group

// "req.host.js" -> "req."   "test_utils.py" -> "test_"   "index.js" -> null   ".eslintrc.js" -> null
export function groupPrefix(name) {
  const m = /^([A-Za-z0-9]{2,})([.\-_])/.exec(name);
  if (!m) return null;
  if ((name.match(/[.\-_]/g) || []).length < 2) return null;
  return (m[1] + m[2]).toLowerCase();
}

// Turns a long, sorted folder listing into: folders, then groups of similar files, then loose files.
// Small folders (<= PAGE items) are returned unchanged.
// Group shape: { type: "group", key, prefix, name, files: [items] }
export function groupItems(items) {
  if (items.length <= PAGE) return items;
  const buckets = new Map();
  for (const it of items) {
    if (it.type !== "file") continue;
    const p = groupPrefix(it.name);
    if (!p) continue;
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p).push(it);
  }
  const groups = [];
  const inGroup = new Set();
  for (const [p, files] of buckets) {
    if (files.length < GROUP_MIN) continue;
    files.forEach((f) => inGroup.add(f.path));
    groups.push({ type: "group", key: p, prefix: p, name: `${p}*`, files });
  }
  groups.sort((a, b) => a.key.localeCompare(b.key));
  const dirs = items.filter((i) => i.type === "dir");
  const loose = items.filter((i) => i.type === "file" && !inGroup.has(i.path));
  return [...dirs, ...groups, ...loose];
}
