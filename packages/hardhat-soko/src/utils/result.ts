import { styleText } from "node:util";
import { LOG_COLORS } from "./colors";

export function toAsyncResult<T, TError = Error>(
  promise: Promise<T>,
  opts: {
    debug?: boolean;
  } = {},
): Promise<{ success: true; value: T } | { success: false; error: TError }> {
  return promise
    .then((value) => ({ success: true as const, value }))
    .catch((error) => {
      if (opts.debug) {
        console.error(styleText(LOG_COLORS.error, "[Debug error] - "), error);
      }
      return { success: false as const, error };
    });
}
