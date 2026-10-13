import { CellValueType, LocaleType, LogLevel, Univer, UniverInstanceType } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import "@univerjs/engine-formula/facade";
import "@univerjs/sheets/facade";
import "@univerjs/sheets-formula/facade";
import "@univerjs/sheets-numfmt/facade";

export const FORMULA_CASES = [
  ["sum", "=SUM(A1:A4)", 35],
  ["average", "=AVERAGE(A1:A4)", 8.75],
  ["minimum", "=MIN(A1:A4)", -5],
  ["maximum", "=MAX(A1:A4)", 20],
  ["round", "=ROUND(10.126,2)", 10.13],
  ["if", '=IF(A1>5,"yes","no")', "yes"],
  ["iferror", '=IFERROR(1/0,"invalid")', "invalid"],
  ["count", "=COUNT(A1:B4)", 4],
  ["counta", "=COUNTA(A1:B4)", 8],
  ["countif", '=COUNTIF(B1:B4,"retail")', 2],
  ["sumif", '=SUMIF(B1:B4,"retail",A1:A4)', 30],
  ["sumifs", '=SUMIFS(A1:A4,B1:B4,"retail",A1:A4,">10")', 20],
  ["arithmetic", "=(A1+A2)*2-A3/5", 61],
  ["cross-sheet", "='Rates'!A1*A1", 12.5],
  ["absolute-reference", "=$A$2*2", 40],
];

function fixture() {
  const cellData = Object.fromEntries([10, 20, -5, 10].map((value, row) => [row, {
    0: { v: value, t: CellValueType.NUMBER },
    1: { v: row < 2 ? "retail" : "service", t: CellValueType.STRING },
  }]));
  FORMULA_CASES.forEach(([, formula], row) => {
    cellData[row] ??= {};
    cellData[row][3] = { f: formula };
  });
  return {
    id: "tirlik-preflight-formulas",
    name: "Synthetic formula compatibility",
    appVersion: "1.0.4",
    locale: LocaleType.EN_US,
    sheetOrder: ["data", "rates"],
    sheets: {
      data: { id: "data", name: "Data", rowCount: 30, columnCount: 6, cellData },
      rates: { id: "rates", name: "Rates", rowCount: 5, columnCount: 2, cellData: { 0: { 0: { v: 1.25, t: CellValueType.NUMBER } } } },
    },
  };
}

export async function proveFormulas() {
  // No DOM, canvas, render surface, browser, or screenshot is created.
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS }, logLevel: LogLevel.ERROR });
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  const api = FUniver.newAPI(univer);
  try {
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, fixture());
    const engine = api.getFormula();
    engine.executeCalculation();
    await engine.onCalculationResultApplied(5_000);
    const workbook = api.getActiveWorkbook();
    const sheet = workbook.getSheetBySheetId("data");
    const actual = sheet.getRange("D1:D15").getValues().map((row) => row[0]);
    const results = FORMULA_CASES.map(([name, formula, expected], index) => ({ name, formula, expected, actual: actual[index] }));
    sheet.getRange("A1").setValue(30);
    await engine.onCalculationResultApplied(5_000);
    const changed = { sum: sheet.getRange("D1").getValue(), crossSheet: sheet.getRange("D14").getValue() };
    const saved = workbook.save();
    return { engine: "@univerjs/engine-formula", results, changed, snapshotHasFormulas: saved.sheets.data.cellData[0][3].f === "=SUM(A1:A4)", browserUsed: false };
  } finally {
    univer.dispose();
  }
}
