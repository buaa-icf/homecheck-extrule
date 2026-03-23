#!/usr/bin/env python3

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Optional


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export recursive split scan rule totals grouped by project",
    )
    parser.add_argument(
        "--merged-issues",
        default="./report/recursiveSplitScans/mergedIssuesReport.json",
        help="Path to mergedIssuesReport.json",
    )
    parser.add_argument(
        "--summary",
        default="./report/recursiveSplitScans/summary.json",
        help="Path to summary.json produced by recursiveSplitScan",
    )
    parser.add_argument(
        "--output-csv",
        default="./report/recursiveSplitScans/project_rule_totals.csv",
        help="Output CSV path",
    )
    return parser.parse_args()


def validate_projects(summary: dict) -> List[str]:
    projects = summary.get("projects")
    if not isinstance(projects, list) or not projects:
        raise ValueError("summary.json is missing a non-empty 'projects' list")

    normalized: List[str] = []
    for item in projects:
        if not isinstance(item, str) or not item:
            raise ValueError("summary.json contains an invalid project name")
        normalized.append(item)
    return normalized


def find_project(file_path: str, repos_root: Path, projects: Iterable[str]) -> Optional[str]:
    try:
        relative_path = Path(file_path).relative_to(repos_root)
    except ValueError:
        return None

    if not relative_path.parts:
        return None

    candidate = relative_path.parts[0]
    if candidate in projects:
        return candidate
    return None


def count_rules_by_project(
    issues: list,
    repos_root: Path,
    projects: List[str],
) -> Dict[str, Counter]:
    counts = {project: Counter() for project in projects}
    project_set = set(projects)

    for issue in issues:
        if not isinstance(issue, dict):
            continue

        file_path = issue.get("filePath")
        messages = issue.get("messages")
        if not isinstance(file_path, str) or not isinstance(messages, list):
            continue

        project = find_project(file_path, repos_root, project_set)
        if project is None:
            continue

        for message in messages:
            if not isinstance(message, dict):
                continue
            rule = message.get("rule")
            if isinstance(rule, str) and rule:
                counts[project][rule] += 1

    return counts


def collect_rules(counts: Dict[str, Counter]) -> List[str]:
    rules = set()
    for project_counts in counts.values():
        rules.update(project_counts.keys())
    return sorted(rules)


def write_csv(output_csv: Path, projects: List[str], counts: Dict[str, Counter]) -> int:
    rules = collect_rules(counts)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    with output_csv.open("w", encoding="utf-8", newline="") as handle:
        fieldnames = ["rule", *projects, "total"]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()

        for rule in rules:
            row = {"rule": rule}
            total = 0
            for project in projects:
                count = counts[project][rule]
                row[project] = str(count)
                total += count
            row["total"] = str(total)
            writer.writerow(row)

    return len(rules)


def main() -> int:
    args = parse_args()
    merged_issues_path = Path(args.merged_issues).resolve()
    summary_path = Path(args.summary).resolve()
    output_csv = Path(args.output_csv).resolve()

    if not merged_issues_path.exists():
        print(f"merged issues file not found: {merged_issues_path}", file=sys.stderr)
        return 1
    if not summary_path.exists():
        print(f"summary file not found: {summary_path}", file=sys.stderr)
        return 1

    issues = load_json(merged_issues_path)
    summary = load_json(summary_path)

    if not isinstance(issues, list):
        print("mergedIssuesReport.json must contain a list", file=sys.stderr)
        return 1
    if not isinstance(summary, dict):
        print("summary.json must contain an object", file=sys.stderr)
        return 1

    try:
        projects = validate_projects(summary)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    repos_root_value = summary.get("reposRoot")
    if not isinstance(repos_root_value, str) or not repos_root_value:
        print("summary.json is missing 'reposRoot'", file=sys.stderr)
        return 1

    repos_root = Path(repos_root_value)
    counts = count_rules_by_project(issues, repos_root, projects)
    rule_count = write_csv(output_csv, projects, counts)

    print(
        f"Wrote {rule_count} rules across {len(projects)} projects to {output_csv}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
