#!/usr/bin/env python3

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Tuple


EXCLUDE_GLOBS = [
    "!**/ohosTest/**",
    "!**/test/**",
    "!**/node_modules/**",
    "!**/build/**",
    "!**/hvigorfile/**",
    "!**/oh_modules/**",
    "!**/.preview/**",
]

EXCLUDE_DIRS = "ohosTest,test,node_modules,build,hvigorfile,oh_modules,.preview"

RULE_TO_COLUMN = {
    "@extrulesproject/long-method-check": "long_method",
    "@extrulesproject/feature-envy-check": "feature_envy",
    "@extrulesproject/switch-statement-check": "switch_statement",
    "@extrulesproject/code-clone-fragment-check": "code_clone_fragment",
    "@extrulesproject/code-clone-type1-check": "code_clone_type1",
    "@extrulesproject/code-clone-type2-check": "code_clone_type2",
}

SMELL_COLUMNS = [
    "long_method",
    "feature_envy",
    "switch_statement",
    "code_clone_fragment",
    "code_clone_type1",
    "code_clone_type2",
]


def run_command(cmd: List[str]) -> str:
    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(cmd)}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    return result.stdout


def rg_file_count(project_path: Path, extension: str) -> int:
    if not project_path.exists():
        return 0
    cmd = ["rg", "--files", str(project_path), "-g", f"*.{extension}"]
    for pattern in EXCLUDE_GLOBS:
        cmd.extend(["-g", pattern])
    output = run_command(cmd)
    text = output.strip()
    if not text:
        return 0
    return len(text.splitlines())


def cloc_code_lines(project_path: Path) -> int:
    if not project_path.exists():
        return 0
    cmd = [
        "cloc",
        str(project_path),
        "--json",
        "--quiet",
        "--include-ext=ts,ets",
        "--force-lang=TypeScript,ets",
        f"--exclude-dir={EXCLUDE_DIRS}",
    ]
    output = run_command(cmd)
    start = output.find("{")
    end = output.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise RuntimeError(f"Failed to parse cloc json output for {project_path}")
    data = json.loads(output[start : end + 1])
    return int(data.get("SUM", {}).get("code", 0))


def load_issues(issues_path: Path) -> List[dict]:
    if not issues_path.exists():
        return []
    with issues_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    return []


def count_smells(issues: List[dict]) -> Dict[str, int]:
    counts = {key: 0 for key in SMELL_COLUMNS}
    for item in issues:
        messages = item.get("messages", [])
        if not isinstance(messages, list):
            continue
        for message in messages:
            if not isinstance(message, dict):
                continue
            rule = message.get("rule")
            column = RULE_TO_COLUMN.get(rule)
            if column:
                counts[column] += 1
    return counts


def avg_loc_per_issue(loc: int, count: int) -> str:
    if count <= 0:
        return ""
    return f"{loc / count:.2f}"


def collect_project_dirs(batch_dir: Path) -> List[Path]:
    dirs: List[Path] = []
    for child in sorted(batch_dir.iterdir(), key=lambda p: p.name):
        if child.is_dir() and (child / "issuesReport.json").exists():
            dirs.append(child)
    return dirs


def build_row(project_name: str, project_path: Path, issues_path: Path) -> Dict[str, str]:
    ts_files = rg_file_count(project_path, "ts")
    ets_files = rg_file_count(project_path, "ets")
    total_files = ts_files + ets_files
    code_lines = cloc_code_lines(project_path)
    issues = load_issues(issues_path)
    smells = count_smells(issues)
    total_smells = sum(smells.values())

    row: Dict[str, str] = {
        "project": project_name,
        "project_path": str(project_path),
        "issues_report_path": str(issues_path),
        "ts_file_count": str(ts_files),
        "ets_file_count": str(ets_files),
        "ts_ets_file_count_total": str(total_files),
        "code_lines": str(code_lines),
        "smell_total": str(total_smells),
        "avg_loc_per_smell_total": avg_loc_per_issue(code_lines, total_smells),
    }

    for key in SMELL_COLUMNS:
        count = smells[key]
        row[f"{key}_count"] = str(count)
        row[f"{key}_avg_loc_per_issue"] = avg_loc_per_issue(code_lines, count)

    return row


def write_csv(rows: List[Dict[str, str]], output_path: Path) -> None:
    fieldnames = [
        "project",
        "project_path",
        "issues_report_path",
        "ts_file_count",
        "ets_file_count",
        "ts_ets_file_count_total",
        "code_lines",
        "smell_total",
        "avg_loc_per_smell_total",
    ]
    for key in SMELL_COLUMNS:
        fieldnames.append(f"{key}_count")
        fieldnames.append(f"{key}_avg_loc_per_issue")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export per-project TS/ETS and smell metrics to CSV"
    )
    parser.add_argument(
        "--batch-dir",
        default="./report/batchIssuesReports",
        help="Directory containing per-project issuesReport.json files",
    )
    parser.add_argument(
        "--repos-root",
        default="/Users/jiaomingyang/project/arkts/repos",
        help="Repository root where project source directories live",
    )
    parser.add_argument(
        "--output-csv",
        default="./report/batchIssuesReports/project_smell_metrics.csv",
        help="Output CSV path",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    batch_dir = Path(args.batch_dir).resolve()
    repos_root = Path(args.repos_root).resolve()
    output_csv = Path(args.output_csv).resolve()

    if not batch_dir.exists():
        print(f"batch dir not found: {batch_dir}", file=sys.stderr)
        return 1

    project_dirs = collect_project_dirs(batch_dir)
    if not project_dirs:
        print(f"no project issuesReport.json found under: {batch_dir}", file=sys.stderr)
        return 1

    rows: List[Dict[str, str]] = []
    for project_dir in project_dirs:
        project_name = project_dir.name
        project_path = repos_root / project_name
        issues_path = project_dir / "issuesReport.json"
        print(f"[processing] {project_name}")
        try:
            row = build_row(project_name, project_path, issues_path)
            rows.append(row)
        except Exception as err:
            print(f"[error] {project_name}: {err}", file=sys.stderr)
            return 1

    write_csv(rows, output_csv)
    print(f"[done] csv: {output_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
