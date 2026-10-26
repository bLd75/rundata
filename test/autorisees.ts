/**
 * src/providers/autorisations.ts as if every source had agreed, the communes, the halls and the sports sites: their sites read, for the tests of their readers
 * (`vi.mock("../src/providers/autorisations.js", () => import("./autorisees.js"))`). What is said while none has
 * agreed: test/autorisations.test.ts.
 */
import { vi } from "vitest";
import type { Autorisation, SourceNonReprise } from "../src/providers/autorisations.js";

export const AUTORISATIONS: Record<string, Autorisation> = {};
export const autorisee = () => true;
export const nonAutorisees = (): Autorisation[] => [];
export const nonAutorisee = () => undefined;
// The halls and the sports sites too.
export const NON_REPRISES: Record<string, SourceNonReprise> = {};
export const nonReprises = (): SourceNonReprise[] => [];
// The media not read are not a matter of a commune's agreement: as they are.
export const { MEDIAS } = await vi.importActual<typeof import("../src/providers/autorisations.js")>("../src/providers/autorisations.js");
