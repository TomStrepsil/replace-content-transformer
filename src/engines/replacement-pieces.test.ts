import { beforeAll, describe, it, expect, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  collectEngineSink,
  foreignRealmUtf8,
  inResizableArrayBuffer,
  refuseResizableBuffersInTextDecoder,
  sinkKinds,
  textOfPieces,
  utf8
} from "../../test/utilities.ts";

type ReplacementPieces = typeof import("./replacement-pieces.ts");

const utf8Checks = [
  {
    utf8Check: "node:buffer's isUtf8, as in Node, Deno and Bun",
    load: (): Promise<ReplacementPieces> => import("./replacement-pieces.ts")
  },
  {
    utf8Check: "a fatal TextDecoder, as in browsers",
    load: async (): Promise<ReplacementPieces> => {
      vi.resetModules();
      const getBuiltinModule = vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
      try {
        return await import("./replacement-pieces.ts");
      } finally {
        getBuiltinModule.mockRestore();
      }
    }
  }
];

describe.each(utf8Checks)("checking bytes with $utf8Check", ({ load }) => {
  let replacementPieceForwarder: ReplacementPieces["replacementPieceForwarder"];

  beforeAll(async () => {
    ({ replacementPieceForwarder } = await load());
  });

  describe.each(sinkKinds)("replacementPieceForwarder, for $sinkKind", ({ acceptsBytes }) => {
    const forwarded = (...replacements: unknown[][]) => {
      const { sink, chunks } = collectEngineSink({ acceptsBytes });
      const forwarder = replacementPieceForwarder(sink);
      for (const pieces of replacements) {
        for (const piece of pieces) forwarder.piece(piece as string | Uint8Array);
        forwarder.end();
      }
      return textOfPieces(chunks);
    };

    describe("a byte order mark", () => {
      it("is dropped at the start of a run of bytes", () => {
        expect(forwarded([utf8("\uFEFFa")])).toBe("a");
      });

      it("is dropped when split across the first pieces of a run of bytes", () => {
        expect(forwarded([Uint8Array.of(0xef), Uint8Array.of(0xbb), Uint8Array.of(0xbf, 0x61)])).toBe("a");
      });

      it("is dropped when it is the whole of the first piece of a run of bytes", () => {
        expect(forwarded([utf8("\uFEFF"), utf8("a")])).toBe("a");
      });

      it("is dropped at the start of each replacement", () => {
        expect(forwarded([utf8("\uFEFFa")], [utf8("\uFEFFb")])).toBe("ab");
      });

      it("is dropped at the start of bytes that follow a string piece", () => {
        expect(forwarded(["x", utf8("\uFEFFa")])).toBe("xa");
      });

      it("is kept after other bytes of the same run", () => {
        expect(forwarded([utf8("x"), utf8("\uFEFFa")])).toBe("x\uFEFFa");
      });

      it("is kept after a character the run left incomplete before it, which becomes U+FFFD", () => {
        expect(forwarded([Uint8Array.of(0xe2, 0x82), utf8("\uFEFFa")])).toBe("\uFFFD\uFEFFa");
      });

      it("is kept after an empty string piece within a run of bytes, since an empty string doesn't end the run", () => {
        expect(forwarded([utf8("x"), "", utf8("\uFEFFa")])).toBe("x\uFEFFa");
      });

      it("keeps a partial byte order mark that a later piece doesn't complete, in order", () => {
        expect(forwarded([Uint8Array.of(0xef, 0xbb), Uint8Array.of(0x61)])).toBe("\uFFFDa");
      });

      it("keeps a partial byte order mark before a string piece, in order", () => {
        expect(forwarded([Uint8Array.of(0xef), "x"])).toBe("\uFFFDx");
      });

      it("keeps a partial byte order mark that ends the replacement", () => {
        expect(forwarded([Uint8Array.of(0xef, 0xbb)], ["y"])).toBe("\uFFFDy");
      });

      it("keeps a character whose first byte starts a byte order mark", () => {
        expect(forwarded([utf8("\uFEFE")])).toBe("\uFEFE");
      });

      it("is dropped when split across pieces from a source that reuses its buffer, such as a Node Buffer", () => {
        const { sink, chunks } = collectEngineSink({ acceptsBytes });
        const forwarder = replacementPieceForwarder(sink);
        const reused = Buffer.from([0xef, 0xbb]);

        forwarder.piece(reused);
        reused.set(utf8("ab"));
        forwarder.piece(Uint8Array.of(0xbf, 0x63));
        forwarder.end();

        expect(textOfPieces(chunks)).toBe("c");
      });
    });

    describe("a character a replacement's bytes leave incomplete", () => {
      it("becomes U+FFFD at the end of the replacement, rather than being completed by the next replacement's bytes", () => {
        expect(forwarded([Uint8Array.of(0xe2, 0x82)], [Uint8Array.of(0xac)])).toBe("\uFFFD\uFFFD");
      });

      it("becomes U+FFFD before a string piece, which can't complete it", () => {
        expect(forwarded([Uint8Array.of(0xe2, 0x82), "x", Uint8Array.of(0xac)])).toBe("\uFFFDx\uFFFD");
      });
    });

    describe("malformed bytes", () => {
      it("become U+FFFD, as a TextDecoder decodes them", () => {
        expect(forwarded([Uint8Array.of(0x61, 0xff, 0xe2, 0x82, 0x62)])).toBe("a\uFFFD\uFFFDb");
      });

      it("become U+FFFD where a piece doesn't continue the character the piece before it started", () => {
        expect(forwarded([Uint8Array.of(0xe2), Uint8Array.of(0x61)])).toBe("\uFFFDa");
      });

      it("leave a character split across the pieces after them whole", () => {
        expect(forwarded([Uint8Array.of(0xff, 0xe2), Uint8Array.of(0x82, 0xac)])).toBe("\uFFFD€");
      });

      it("leave a byte order mark that follows them in the same run of bytes", () => {
        expect(forwarded([Uint8Array.of(0xff), utf8("\uFEFFa")])).toBe("\uFFFD\uFEFFa");
      });

      it("leave a byte order mark at the start of the next replacement to be dropped", () => {
        expect(forwarded([Uint8Array.of(0xff)], [utf8("\uFEFFa")])).toBe("\uFFFDa");
      });

      it("leave a second byte order mark, after the one dropped at the start of a run of bytes", () => {
        expect(forwarded([Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0xff, 0x61)])).toBe("\uFEFF\uFFFDa");
      });

      it("become U+FFFD as a TextDecoder counts them, at the end of a replacement", () => {
        expect(forwarded([Uint8Array.of(0x61, 0xf0, 0x80)])).toBe("a\uFFFD\uFFFD");
      });

      it("leave a byte order mark split across the pieces before them to be dropped", () => {
        expect(forwarded([Uint8Array.of(0xef, 0xbb), Uint8Array.of(0xbf, 0xff)])).toBe("\uFFFD");
      });
    });

    describe("bytes in a resizable ArrayBuffer", () => {
      it.each([
        { bytes: "valid", piece: utf8("a€"), text: "a€" },
        { bytes: "malformed", piece: Uint8Array.of(0x61, 0xff), text: "a\uFFFD" }
      ])("are read when $bytes, though browsers' TextDecoder refuses them", ({ piece, text }) => {
        refuseResizableBuffersInTextDecoder();

        expect(forwarded([inResizableArrayBuffer(piece)])).toBe(text);
      });
    });

    describe("bytes from another realm", () => {
      it("are read as bytes, as a fetch body's chunks are by code run in a vm context, such as a Jest test environment", () => {
        expect(forwarded(["a", foreignRealmUtf8("€"), "b"])).toBe("a€b");
      });
    });

    describe("a piece that is not bytes, nor a non-empty string", () => {
      it.each([undefined, null, ""])("is skipped when %j, without ending a run of bytes", (piece) => {
        expect(forwarded([Uint8Array.of(0xe2, 0x82), piece, Uint8Array.of(0xac)])).toBe("€");
      });

      it("is converted to a string, as a string piece", () => {
        expect(forwarded(["a", 1, "b"])).toBe("a1b");
      });
    });
  });

  describe("replacementPieceForwarder, for a sink that accepts bytes", () => {
    it("passes the bytes of a replacement after one with malformed bytes on undecoded", () => {
      const { sink, chunks } = collectEngineSink({ acceptsBytes: true });
      const forwarder = replacementPieceForwarder(sink);
      const valid = utf8("a");

      forwarder.piece(Uint8Array.of(0xff, 0xe2));
      forwarder.end();
      forwarder.piece(valid);
      forwarder.end();

      expect(chunks.at(-1)).toBe(valid);
    });

    it("passes valid bytes in a resizable ArrayBuffer on undecoded, though browsers' TextDecoder refuses them", () => {
      refuseResizableBuffersInTextDecoder();
      const { sink, chunks } = collectEngineSink({ acceptsBytes: true });
      const forwarder = replacementPieceForwarder(sink);
      const resizable = inResizableArrayBuffer(utf8("a€"));

      forwarder.piece(resizable);
      forwarder.end();

      expect(chunks).toEqual([resizable]);
      expect(chunks[0]).toBe(resizable);
    });
  });
});
