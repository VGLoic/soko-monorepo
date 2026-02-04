import ora, { Ora } from "ora";
import boxen from "boxen";
import { styleText } from "node:util";

/**
 * CLI UI utilities for enhanced terminal output
 */

/**
 * Creates a step tracker for multi-step operations
 */
export class StepTracker {
  private currentStep: number;
  private readonly totalSteps: number;
  private spinner: Ora | undefined;

  constructor(totalSteps: number) {
    this.currentStep = 0;
    this.totalSteps = totalSteps;
  }

  /**
   * Start a new step with a spinner
   */
  start(message: string): Ora {
    this.currentStep++;
    const prefix = styleText(
      "cyan",
      `[${this.currentStep}/${this.totalSteps}]`,
    );
    this.spinner = ora({
      text: message,
      prefixText: prefix,
      stream: process.stderr,
    }).start();
    return this.spinner;
  }

  /**
   * Mark the current step as successful
   */
  succeed(message?: string): void {
    if (this.spinner) {
      this.spinner.succeed(message);
    }
  }

  /**
   * Mark the current step as failed
   */
  fail(message?: string): void {
    if (this.spinner) {
      this.spinner.fail(message);
    }
  }

  /**
   * Mark the current step as warning
   */
  warn(message?: string): void {
    if (this.spinner) {
      this.spinner.warn(message);
    }
  }

  /**
   * Stop the current spinner without success/fail
   */
  stop(): void {
    if (this.spinner) {
      this.spinner.stop();
    }
  }
}

/**
 * Creates a simple spinner without step tracking
 */
export function createSpinner(message: string): Ora {
  return ora({
    text: message,
    stream: process.stderr,
  }).start();
}

/**
 * Creates a boxed header message
 */
export function boxHeader(message: string): void {
  const boxed = boxen(message, {
    padding: 0,
    margin: { top: 1, bottom: 0, left: 0, right: 0 },
    borderStyle: "round",
    borderColor: "cyan",
  });
  console.error(boxed);
}

/**
 * Creates a boxed summary with multiple lines
 */
export function boxSummary(title: string, lines: string[]): void {
  const boldTitle = styleText("bold", title);
  const content = `${boldTitle}\n\n${lines.join("\n")}`;
  const boxed = boxen(content, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: "round",
    borderColor: "cyan",
  });
  console.error(boxed);
}

/**
 * Enhanced success message
 */
export function success(message: string): void {
  console.error(styleText("green", `✔ ${message}`));
}

/**
 * Enhanced error message
 */
export function error(message: string): void {
  console.error(styleText("red", `✖ ${message}`));
}

/**
 * Enhanced warning message
 */
export function warn(message: string): void {
  console.error(styleText("yellow", `⚠ ${message}`));
}

/**
 * Enhanced info message
 */
export function info(message: string): void {
  console.error(styleText("cyan", `ℹ ${message}`));
}

/**
 * Creates a colored table header row with fixed column widths
 */
export function colorTableHeaders(
  data: Record<string, unknown>[],
  headers: string[],
): void {
  if (data.length === 0) {
    return;
  }

  // Calculate the maximum width for each column
  const columnWidths: Record<string, number> = {};
  for (const header of headers) {
    // Start with header length
    columnWidths[header] = header.length;

    // Check all data rows for maximum width
    for (const row of data) {
      const value = row[header];
      const valueLength = String(value).length;
      if (valueLength > columnWidths[header]) {
        columnWidths[header] = valueLength;
      }
    }
  }

  // Pad a string to a specific width
  const pad = (str: string, width: number): string => {
    return str + " ".repeat(Math.max(0, width - str.length));
  };

  // Create header row with fixed widths
  const headerRow = headers
    .map((h) => styleText(["bold", "cyan"], pad(h, columnWidths[h]!)))
    .join(" │ ");
  console.error(`\n ${headerRow}`);

  // Create separator row
  const separatorRow = headers
    .map((h) => "─".repeat(columnWidths[h]!))
    .join("─┼─");
  console.error(` ${separatorRow}`);

  // Print data rows with fixed widths
  for (const row of data) {
    const values = headers.map((h) => {
      const value = row[h];
      const strValue = String(value);
      const paddedValue = pad(strValue, columnWidths[h]!);

      // Color the padded value
      if (typeof value === "string") {
        // Color tags (strings that look like versions)
        if (h === "Tag" && value) {
          return styleText("green", paddedValue);
        }
        // Color IDs
        if (h === "ID" && value) {
          return styleText("yellow", paddedValue);
        }
        // Color projects
        if (h === "Project" && value) {
          return styleText("magenta", paddedValue);
        }
      }
      return paddedValue;
    });
    console.error(` ${values.join(" │ ")}`);
  }
  console.error();
}
