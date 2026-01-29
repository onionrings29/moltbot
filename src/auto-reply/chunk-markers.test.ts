import { describe, it, expect } from "vitest";
import { parseChunkMarkers, splitByChunkMarkers } from "./chunk-markers.js";

describe("chunk-markers", () => {
  describe("parseChunkMarkers", () => {
    it("should return empty array for undefined config", () => {
      expect(parseChunkMarkers(undefined)).toEqual([]);
    });

    it("should return default markers when enabled=true but no custom markers", () => {
      expect(parseChunkMarkers({ enabled: true })).toEqual(["[MSG]", "<nl>"]);
    });

    it("should return custom markers when provided", () => {
      expect(parseChunkMarkers({ enabled: true, markers: ["[SPLIT]", "---"] })).toEqual([
        "[SPLIT]",
        "---",
      ]);
    });

    it("should return empty array when enabled=false", () => {
      expect(parseChunkMarkers({ enabled: false })).toEqual([]);
    });
  });

  describe("splitByChunkMarkers", () => {
    it("should not split text without markers", () => {
      const result = splitByChunkMarkers("Hello world", ["[MSG]"]);
      expect(result).toEqual(["Hello world"]);
    });

    it("should split on [MSG] marker and remove it", () => {
      const result = splitByChunkMarkers("First part[MSG]Second part", ["[MSG]"]);
      expect(result).toEqual(["First part", "Second part"]);
    });

    it("should split on multiple markers", () => {
      const result = splitByChunkMarkers("One[MSG]Two<nl>Three", ["[MSG]", "<nl>"]);
      expect(result).toEqual(["One", "Two", "Three"]);
    });

    it("should handle markers at start/end", () => {
      const result = splitByChunkMarkers("[MSG]Start[MSG]End[MSG]", ["[MSG]"]);
      expect(result).toEqual(["", "Start", "End", ""]);
    });

    it("should trim whitespace around splits", () => {
      const result = splitByChunkMarkers("First  [MSG]  Second  ", ["[MSG]"]);
      expect(result).toEqual(["First", "Second"]);
    });

    it("should respect minChunkSize and merge small chunks", () => {
      const result = splitByChunkMarkers("A[MSG]B", ["[MSG]"], { minChunkSize: 5 });
      expect(result).toEqual(["AB"]);
    });

    it("should not merge chunks that exceed minChunkSize", () => {
      const result = splitByChunkMarkers("Long text here[MSG]Another long text", ["[MSG]"], {
        minChunkSize: 5,
      });
      expect(result).toEqual(["Long text here", "Another long text"]);
    });
  });
});
