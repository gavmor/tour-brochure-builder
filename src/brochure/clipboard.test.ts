import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}

describe("copyText", () => {
  it("uses the async clipboard when it is available", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    await expect(copyText("https://example.com/#view&t=abc")).resolves.toBe(
      "clipboard",
    );
    expect(writeText).toHaveBeenCalledWith("https://example.com/#view&t=abc");
  });

  it("falls back to a selection copy when the clipboard is blocked", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;

    await expect(copyText("link")).resolves.toBe("fallback");
    expect(execCommand).toHaveBeenCalledWith("copy");
    // The scratch textarea must not be left behind in the document.
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("reports failure when neither path works, so the UI can show the link", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(
      () => false,
    );
    await expect(copyText("link")).resolves.toBe("failed");
  });

  it("refuses to copy nothing", async () => {
    await expect(copyText("")).resolves.toBe("failed");
  });
});
