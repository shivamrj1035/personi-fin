/** Inverse operations recorded for every change, so an Activity Log entry can be undone. */
export type Cell = unknown;
export interface CellWrite { range: string; before: Cell[][]; after: Cell[][] }

export type Op =
  /** Put cells back to what they were. `force` = loan id whose tab-ticks must win over month-tab ticks on the next sync. */
  | { op: "cells"; writes: CellWrite[]; force?: string }
  | { op: "deleteFlatById"; tab: string; id: string }
  | { op: "deleteFlatMatch"; tab: string; match: Record<string, unknown> }
  | { op: "appendFlat"; tab: string; row: Record<string, unknown> }
  | { op: "updateFlatById"; tab: string; id: string; vals: Record<string, unknown> }
  | { op: "setSetting"; key: string; value: unknown | null }
  | { op: "deleteLoan"; id: string }
  | { op: "restoreLoan"; snap: LoanSnap }
  | { op: "restoreBlock"; tab: string; block: Cell[][] }
  | { op: "renameTab"; from: string; to: string };

export interface LoanSnap {
  meta: Record<string, unknown>;
  schedule: { inst_no: number; due_date: string; opening: number; principal: number; interest: number; emi: number; closing: number; status: string; paid_on: string }[];
}

export interface ActivityEntry { id: string; at: string; action: string; summary: string; status: "done" | "undone"; undone_at: string; undoable: boolean; row: number }
