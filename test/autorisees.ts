/**
 * src/providers/autorisations.ts as if every source had agreed: their sites read, for the tests of their readers
 * (`vi.mock("../src/providers/autorisations.js", () => import("./autorisees.js"))`). What is said while none has
 * agreed: test/autorisations.test.ts.
 */
import { vi } from "vitest";
import type { Autorisation } from "../src/providers/autorisations.js";

export const AUTORISATIONS: Record<string, Autorisation> = {};
export const autorisee = () => true;
export const nonAutorisees = (): Autorisation[] => [];
export const nonAutorisee = () => undefined;
// The media not read are not a matter of a commune's agreement: as they are.
export const { MEDIAS } = await vi.importActual<typeof import("../src/providers/autorisations.js")>("../src/providers/autorisations.js");
