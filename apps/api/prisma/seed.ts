/* Seed — ported from the client-approved mock so the built system demos identically. */
import { PrismaClient, type OrderStatus, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLE_PERMS, ROLES, invoiceTotals, priceFor, ORDER_FLOW, type Role } from "@vivaha/shared";
import * as stock from "../src/services/stock";
import { nextInvoiceNo } from "../src/services/sequence";

const prisma = new PrismaClient();
const TODAY = new Date();
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 864e5);
const daysAhead = (n: number) => new Date(TODAY.getTime() + n * 864e5);
const minsAhead = (n: number) => new Date(Date.now() + n * 60_000);
const PASSWORD = "demo123";

const LINES = [
  { id: "L1", code: "cards", name: "Cards", nameHi: "कार्ड", icon: "🪔", color: "#A81F52", bg: "#FCEEF3", uom: "PCS", packUoms: ["Box", "Packet", "Dozen"], minSetQty: 500, holdMins: 30, gstPct: 12, stockDims: ["design"], batchTracked: false, pricingModel: "SLAB", workflow: "FULFIL", facets: ["community", "occasion", "paper", "size", "fold"], sortOrder: 1 },
  { id: "L2", code: "consumables", name: "Ink & Chemicals", nameHi: "स्याही व केमिकल", icon: "🛢️", color: "#0E7490", bg: "#ECFAFD", uom: "KG", packUoms: ["Tin", "Drum", "Roll", "Nos"], minSetQty: 25, holdMins: 45, gstPct: 18, stockDims: ["batch"], batchTracked: true, pricingModel: "SLAB", workflow: "FULFIL", facets: ["machine", "brand", "grade"], sortOrder: 2 },
  { id: "L3", code: "signage", name: "Flex", nameHi: "फ़्लेक्स", icon: "🪧", color: "#4338CA", bg: "#EEF0FE", uom: "SQ.FT", packUoms: ["Sheet", "Roll"], minSetQty: 200, holdMins: 45, gstPct: 18, stockDims: ["lot"], batchTracked: false, pricingModel: "AREA", workflow: "FULFIL", facets: ["material", "thickness", "finish"], sortOrder: 3 },
  { id: "L5", code: "acp", name: "ACP", nameHi: "एसीपी", icon: "▭", color: "#B45309", bg: "#FEF6EC", uom: "SQ.FT", packUoms: ["Sheet"], minSetQty: 32, holdMins: 45, gstPct: 18, stockDims: ["lot"], batchTracked: false, pricingModel: "AREA", workflow: "FULFIL", facets: ["material", "thickness", "finish"], sortOrder: 4 },
  { id: "L4", code: "jobwork", name: "Job Work", nameHi: "जॉब वर्क", icon: "🖨️", color: "#15803D", bg: "#ECFDF3", uom: "JOB", packUoms: [], minSetQty: 0, holdMins: 0, gstPct: 18, stockDims: [], batchTracked: false, pricingModel: "QUOTE", workflow: "JOBWORK", facets: ["process", "colours"], sortOrder: 5 },
] as const;
const GODOWNS = [
  { id: "GD-A", name: "Godown A — Junagarh Road", short: "GD-A", manager: "Rahin Qureshi", address: "Plot 14, Junagarh Road Industrial Area, Bikaner" },
  { id: "GD-B", name: "Godown B — Napasar Road", short: "GD-B", manager: "Devendra Suthar", address: "Shed 7, Napasar Road, Bikaner" },
  { id: "GD-C", name: "Godown C — Pugal Road", short: "GD-C", manager: "Khadija Ansari", address: "Unit 3, Pugal Road Storage Complex, Bikaner" },
];
const VENDORS = [
  ["VND-01", "Shree Ganesh Print Works", "08AAQCS4471K1Z9", "Net 30", "Bikaner", "+91 94140 22781"], ["VND-02", "Rajwada Card House", "08AABCR8812M1ZK", "Net 15", "Jodhpur", "+91 94131 55620"],
  ["VND-03", "Marudhar Paper Mills", "08AACCM3390P1ZT", "Advance 50%", "Nokha", "+91 94148 71003"], ["VND-04", "Om Shanti Printers", "08AADCO7712L1ZB", "Net 45", "Bikaner", "+91 94602 31889"],
  ["VND-05", "Suraj Ink & Chemicals", "08AAECS1180N1ZF", "Net 30", "Jaipur", "+91 93518 44127"], ["VND-06", "Nokha Packaging Solutions", "08AAFCN6640J1ZQ", "Net 15", "Nokha", "+91 94142 90055"],
  ["VND-07", "Marwar Signage Supplies", "08AAGCM2214H1ZD", "Net 30", "Bikaner", "+91 94603 12470"],
];
const COMMUNITY = ["Hindu", "Muslim", "Punjabi", "Jain"], OCCASION = ["Wedding", "Reception", "Engagement", "Ceremony", "Money Envelope"];
const PAPER = ["300gsm Art Card", "Handmade Cotton", "Shimmer Board", "Velvet Laminate", "Pearl Finish", "Textured Kraft"], SIZES = ["5.5×8.5 in", "6×9 in", "7×10 in"], FOLDS = ["Double Fold", "Single Panel", "Trifold", "Pocket"];
const CARDNAMES: [string, string][] = [["Royal Scroll", "रॉयल स्क्रॉल"], ["Zari Pocket", "ज़री पॉकेट"], ["Kalash Laser-cut", "कलश लेज़र-कट"], ["Peacock Shimmer", "मोर शिमर"], ["Ganesha Foil", "गणेश फ़ॉइल"], ["Rajwada Velvet", "राजवाड़ा वेलवेट"], ["Shubh Handmade", "शुभ हैंडमेड"], ["Swarna Embossed", "स्वर्ण एम्बॉस्ड"], ["Heritage Trifold", "हेरिटेज ट्राइफ़ोल्ड"], ["Panache Silk-thread", "पनाश सिल्क"], ["Ambience Pearl", "एम्बिएंस पर्ल"], ["Vintage Gold", "विंटेज गोल्ड"], ["Bismillah Crescent", "बिस्मिल्लाह क्रीसेंट"], ["Nikah Emerald", "निकाह एमराल्ड"], ["Mehr Golden", "मेहर गोल्डन"], ["Ek Onkar Khanda", "एक ओंकार खंडा"], ["Anand Karaj Royal", "आनंद कारज रॉयल"], ["Sikh Heritage Maroon", "सिख हेरिटेज मैरून"], ["Jain Mangal Kalash", "जैन मंगल कलश"], ["Navkar Ivory", "नवकार आइवरी"], ["Reception Rose Gold", "रिसेप्शन रोज़ गोल्ड"], ["Reception Onyx", "रिसेप्शन ऑनिक्स"], ["Sagai Blush", "सगाई ब्लश"], ["Shagun Lifafa Classic", "शगुन लिफ़ाफ़ा क्लासिक"], ["Shagun Lifafa Zari", "शगुन लिफ़ाफ़ा ज़री"], ["Mehendi Marigold", "मेहंदी मैरीगोल्ड"]];
const CARDMETA = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1, 0], [1, 0], [1, 0], [2, 0], [2, 0], [2, 0], [3, 0], [3, 0], [0, 1], [0, 1], [0, 2], [0, 4], [0, 4], [0, 3]];
const slabsFor = (base: number) => [{ fromQty: 1, toQty: 499, rate: base }, { fromQty: 500, toQty: 1999, rate: Math.round(base * 0.89) }, { fromQty: 2000, toQty: 4999, rate: Math.round(base * 0.8) }, { fromQty: 5000, toQty: 1e9, rate: Math.round(base * 0.74) }];

function makeItems() {
  const out: Prisma.ItemCreateInput[] = [];
  CARDNAMES.forEach((nm, i) => {
    const [ci, oi] = CARDMETA[i]; const base = 42 + ((i * 17) % 96);
    out.push({ id: "ITM-" + (101 + i), line: { connect: { id: "L1" } }, artSeed: i, sku: "WC-" + (1024 + i * 3), designNo: "DSN-" + (2400 + i * 7), name: nm[0] + " " + (OCCASION[oi] === "Money Envelope" ? "Envelope" : OCCASION[oi] + " Card"), nameHi: nm[1], attrs: { community: COMMUNITY[ci], occasion: OCCASION[oi], paper: PAPER[i % PAPER.length], size: SIZES[i % 3], fold: FOLDS[i % 4] }, uom: "PCS", packUom: ["Box", "Packet", "Dozen"][i % 3], perPack: [50, 10, 12][i % 3], moq: [50, 10, 12][i % 3] * 5, landedCost: Math.round(base * 0.58), hsn: "4817", gstPct: 12, vendor: { connect: { id: VENDORS[i % 4][0] } }, status: i === 19 ? "DISCONTINUED" : "ACTIVE", season: "2026-S2", slabs: { create: slabsFor(base) } });
  });
  const cons: [string, string, string, string, string, string, string, number, number, string][] = [["Offset Process Ink — Black", "ऑफ़सेट ब्लैक स्याही", "SGL", "Offset", "Premium", "KG", "Tin", 5, 412, "3215"], ["Offset Process Ink — Cyan", "ऑफ़सेट सायन स्याही", "SGL", "Offset", "Premium", "KG", "Tin", 5, 438, "3215"], ["Offset Process Ink — Magenta", "ऑफ़सेट मैजेंटा स्याही", "SGL", "Offset", "Premium", "KG", "Tin", 5, 438, "3215"], ["Offset Process Ink — Yellow", "ऑफ़सेट येलो स्याही", "SGL", "Offset", "Premium", "KG", "Tin", 5, 426, "3215"], ["Gold Metallic Ink", "गोल्ड मेटैलिक स्याही", "Sicpa", "Offset", "Premium", "KG", "Tin", 2, 1180, "3215"], ["Screen Ink — Gold Bronze", "स्क्रीन गोल्ड ब्रॉन्ज़", "Ferro", "Screen", "Standard", "KG", "Tin", 5, 690, "3215"], ["Fountain Solution Concentrate", "फ़ाउंटेन सोल्यूशन", "Varn", "Offset", "Standard", "LTR", "Drum", 20, 268, "3814"], ["Roller Wash Solvent", "रोलर वॉश सॉल्वेंट", "Varn", "Offset", "Standard", "LTR", "Drum", 20, 182, "3814"], ["Blanket Wash", "ब्लैंकेट वॉश", "Anchor", "Offset", "Standard", "LTR", "Drum", 20, 196, "3814"], ["Roller Cloth 620mm", "रोलर क्लॉथ 620mm", "Kinyo", "Offset", "Standard", "NOS", "Roll", 1, 1450, "5911"], ["Roller Cloth 720mm", "रोलर क्लॉथ 720mm", "Kinyo", "Offset", "Standard", "NOS", "Roll", 1, 1680, "5911"], ["Offset Blanket 4-ply", "ऑफ़सेट ब्लैंकेट 4-ply", "Trelleborg", "Offset", "Premium", "NOS", "Nos", 1, 4250, "5911"], ["CTP Plate 605×745", "CTP प्लेट 605×745", "Techno", "Offset", "Standard", "NOS", "Nos", 1, 318, "3701"], ["Screen Emulsion", "स्क्रीन इमल्शन", "Ulano", "Screen", "Standard", "KG", "Tin", 1, 890, "3707"]];
  cons.forEach((c, i) => out.push({ id: "ITM-" + (201 + i), line: { connect: { id: "L2" } }, artSeed: i, sku: "CN-" + (4400 + i * 5), name: c[0], nameHi: c[1], attrs: { brand: c[2], machine: c[3], grade: c[4] }, uom: c[5], packUom: c[6], perPack: c[7], moq: c[7], landedCost: Math.round(c[8] * 0.72), hsn: c[9], gstPct: 18, vendor: { connect: { id: "VND-05" } }, batchTracked: true, slabs: { create: slabsFor(c[8]) } }));
  const sign: [string, string, string, string, string, string, string, number, number, string][] = [["Star Flex 440 GSM", "स्टार फ़्लेक्स 440", "Flex", "440 GSM", "Matte", "SQ.FT", "Roll", 1000, 26, "3921"], ["Star Flex 510 GSM", "स्टार फ़्लेक्स 510", "Flex", "510 GSM", "Gloss", "SQ.FT", "Roll", 1000, 32, "3921"], ["Backlit Flex 610 GSM", "बैकलिट फ़्लेक्स 610", "Flex", "610 GSM", "Backlit", "SQ.FT", "Roll", 800, 48, "3921"], ["ACP Sheet 3mm Silver", "ACP शीट 3mm सिल्वर", "ACP", "3 mm", "Brushed", "SQ.FT", "Sheet", 32, 92, "7606"], ["ACP Sheet 4mm White", "ACP शीट 4mm व्हाइट", "ACP", "4 mm", "Gloss", "SQ.FT", "Sheet", 32, 118, "7606"], ["Acrylic Clear 3mm", "ऐक्रिलिक क्लियर 3mm", "Acrylic", "3 mm", "Clear", "SQ.FT", "Sheet", 32, 164, "3920"], ["Acrylic Milky 5mm", "ऐक्रिलिक मिल्की 5mm", "Acrylic", "5 mm", "Milky", "SQ.FT", "Sheet", 32, 238, "3920"], ["Non-Woven Bag Fabric 90 GSM", "नॉन-वोवन 90 GSM", "Non-Woven", "90 GSM", "Plain", "SQ.FT", "Roll", 1200, 14, "5603"]];
  sign.forEach((c, i) => out.push({ id: "ITM-" + (301 + i), line: { connect: { id: c[2] === "ACP" ? "L5" : "L3" } }, artSeed: i, sku: "SG-" + (7100 + i * 4), name: c[0], nameHi: c[1], attrs: { material: c[2], thickness: c[3], finish: c[4] }, uom: c[5], packUom: c[6], perPack: c[7], moq: c[6] === "Sheet" ? 32 : 100, landedCost: Math.round(c[8] * 0.74), hsn: c[9], gstPct: 18, vendor: { connect: { id: "VND-07" } }, wastagePct: 6, slabs: { create: slabsFor(c[8]) } }));
  const job: [string, string, string, string, number, number][] = [["Offset Overprint — 1 Colour", "ऑफ़सेट ओवरप्रिंट 1 रंग", "Offset", "1", 2.4, 4500], ["Offset Overprint — 2 Colour", "ऑफ़सेट ओवरप्रिंट 2 रंग", "Offset", "2", 3.6, 6200], ["Screen Overprint — Gold", "स्क्रीन ओवरप्रिंट गोल्ड", "Screen", "1", 4.2, 3800], ["Digital Variable Print", "डिजिटल वेरिएबल प्रिंट", "Digital", "4", 6.5, 2500], ["Foil Stamping", "फ़ॉइल स्टैम्पिंग", "Foil", "1", 5.8, 5400]];
  job.forEach((c, i) => out.push({ id: "ITM-" + (401 + i), line: { connect: { id: "L4" } }, artSeed: i, sku: "JW-" + (9100 + i * 2), name: c[0], nameHi: c[1], attrs: { process: c[2], colours: c[3] }, uom: "JOB", packUom: "", perPack: 1, moq: 250, landedCost: c[4] * 0.6, hsn: "9989", gstPct: 18, setupCharge: c[5], wastagePct: 4, slabs: { create: [{ fromQty: 1, toQty: 1e9, rate: c[4] }] } }));
  return out;
}

const MULT: Record<string, number> = { Cash: 1.2, Regular: 1.25, Credit: 1.35, Dealer: 1.18, Distributor: 1.12, Premium: 1.15 };
const TEHSILS = ["Bikaner", "Nokha", "Napasar", "Churu", "Nagaur", "Merta", "Sri Ganganagar", "Hanumangarh", "Pushkar", "Jodhpur", "Deshnok", "Lunkaransar"];
type RawCust = [string, string, string, string, number, number, "WARN" | "BLOCK", string | null, string[], [string, Record<string, string>][]];
const RAW_CUST: RawCust[] = [
  ["Sharma Wedding Planners", "Vikram Sharma", "Regular", "Bikaner", 150000, 30, "WARN", "sharma_wedding", ["L1", "L4"], [["Offset", { colours: "2", ink: "SGL", company: "Heidelberg GTO 52", roller: "620 mm", chem: "Varn", industry: "Wedding Stationery" }]]],
  ["Rajputana Cards & Gifts", "Meenakshi Rathore", "Dealer", "Nokha", 300000, 45, "WARN", "rajputana_cards", ["L1", "L2", "L4"], [["Offset", { colours: "4", ink: "SGL", company: "Komori Sprint 4", roller: "720 mm", chem: "Anchor", industry: "Commercial Printing" }], ["Screen", { company: "Manual Table", model: "40×60" }]]],
  ["Golden Invites Bikaner", "Arif Khan", "Distributor", "Bikaner", 500000, 45, "WARN", "golden_invites", ["L1", "L2", "L3", "L5", "L4"], [["Offset", { colours: "4", ink: "Sicpa", company: "Ryobi 524", roller: "720 mm", chem: "Varn", industry: "Commercial Printing" }], ["Flex", { company: "Konica", model: "KM-512i", ink: "Solvent" }], ["UV", { company: "Sunlite", model: "UV-40" }]]],
  ["Marwar Shaadi Bazaar", "Suresh Bishnoi", "Credit", "Nagaur", 200000, 30, "BLOCK", null, ["L1"], [["Screen", { company: "Manual Table", model: "30×40" }]]],
  ["Kalinga Card House", "Priyanka Deora", "Cash", "Churu", 50000, 0, "BLOCK", null, ["L1"], []],
  ["Om Prakash Card Traders", "Om Prakash Vyas", "Regular", "Merta", 120000, 30, "WARN", null, ["L1", "L2"], [["Offset", { colours: "1", ink: "SGL", company: "Rotaprint", roller: "620 mm", chem: "Anchor", industry: "Job Printing" }]]],
  ["Suryodaya Cards Jodhpur", "Naveen Choudhary", "Dealer", "Jodhpur", 250000, 45, "WARN", null, ["L1", "L2", "L3", "L5"], [["Offset", { colours: "2", ink: "SGL", company: "Heidelberg GTO 46", roller: "620 mm", chem: "Varn", industry: "Wedding Stationery" }], ["Flex", { company: "Allwin", model: "E-180", ink: "Eco-Solvent" }]]],
  ["Rani Sati Card Emporium", "Rekha Maheshwari", "Premium", "Bikaner", 350000, 30, "WARN", null, ["L1", "L4"], [["Offset", { colours: "4", ink: "Sicpa", company: "Komori Lithrone", roller: "720 mm", chem: "Varn", industry: "Premium Stationery" }]]],
  ["Ganganagar Card Palace", "Harpreet Singh", "Distributor", "Sri Ganganagar", 400000, 45, "WARN", null, ["L1", "L2"], [["Offset", { colours: "2", ink: "SGL", company: "Ryobi 480", roller: "620 mm", chem: "Anchor", industry: "Commercial Printing" }]]],
  ["Vivah Mangal Cards", "Sunita Rathi", "Cash", "Deshnok", 60000, 0, "BLOCK", null, ["L1"], []],
  ["Nokha Card Centre", "Ramesh Kumawat", "Regular", "Nokha", 100000, 15, "WARN", null, ["L1", "L2"], [["Screen", { company: "Semi-Auto", model: "50×70" }]]],
  ["Shubh Vivah Stationers", "Kavita Soni", "Credit", "Hanumangarh", 180000, 30, "WARN", null, ["L1"], []],
  ["Churu Card Traders", "Deepak Ranga", "Regular", "Churu", 130000, 30, "WARN", null, ["L1", "L3", "L5"], [["Flex", { company: "Konica", model: "KM-512i", ink: "Solvent" }]]],
  ["Pushkar Wedding Emporium", "Ismail Qureshi", "Premium", "Pushkar", 280000, 30, "WARN", null, ["L1", "L4"], [["Offset", { colours: "2", ink: "SGL", company: "Heidelberg GTO 52", roller: "620 mm", chem: "Varn", industry: "Wedding Stationery" }]]],
  ["Lunkaransar Card Mart", "Baljeet Kaur", "Regular", "Lunkaransar", 90000, 15, "WARN", null, ["L1"], []],
  ["Napasar Print & Cards", "Yusuf Pathan", "Dealer", "Napasar", 220000, 45, "WARN", null, ["L1", "L2", "L3", "L5"], [["Offset", { colours: "1", ink: "SGL", company: "Rotaprint", roller: "620 mm", chem: "Anchor", industry: "Job Printing" }]]],
];
// Only the single "admin" login is active for the client demo; the staff users
// exist (inactive) so seeded orders/customers keep their sales-exec references.
const USERS = [
  ["admin", "SUPER_ADMIN", "Admin", "AD", true], ["samar.purchase", "PURCHASE_MANAGER", "Samar Iqbal", "SI", false], ["khadija.sales", "SALES_EXECUTIVE", "Khadija Ansari", "KA", false],
  ["devendra.godown", "GODOWN_MANAGER", "Devendra Suthar", "DS", false], ["farhan.dispatch", "DISPATCH_MANAGER", "Farhan Sheikh", "FS", false], ["rahin.accounts", "ACCOUNTS_MANAGER", "Rahin Qureshi", "RQ", false],
] as const;

async function reset() {
  const tables = ["StockoutSearch", "Referral", "Ad", "Cart", "Kit", "KitVersionItem", "KitVersion", "JobWork", "ReturnRequest", "Payment", "LedgerEntry", "InvoiceLine", "Invoice", "Dispatch", "OrderEvent", "OrderLine", "Order", "Transfer", "VendorPayment", "PurchaseLine", "Purchase", "StockTxn", "StockBalance", "PriceOverride", "CustomerMachine", "CustomerContact", "NotificationRead", "Notification", "AuditLog", "User", "Customer", "ItemCode", "PriceSlab", "Item", "AttributeDef", "Vendor", "Godown", "PricingGroup", "BusinessLine", "RolePermission", "Sequence", "Setting"];
  for (const t of tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`);
}

async function main() {
  await reset();
  const hash = await bcrypt.hash(PASSWORD, 10);
  await prisma.rolePermission.createMany({ data: ROLES.flatMap((role) => DEFAULT_ROLE_PERMS[role as Role].map((perm) => ({ role, perm }))) });
  await prisma.setting.createMany({ data: [{ key: "MIN_MARGIN", value: 0.18 }, { key: "COMPANY", value: { name: "Vivaha Cards", address: "Plot 14, Junagarh Road Industrial Area, Bikaner 334001", gstin: "08AAQCV7781K1ZR", state: "08", phone: "+91 151 220 0000" } }] });
  for (const l of LINES) await prisma.businessLine.create({ data: { ...l, packUoms: [...l.packUoms], stockDims: [...l.stockDims], facets: [...l.facets] } });
  await prisma.godown.createMany({ data: GODOWNS });
  await prisma.vendor.createMany({ data: VENDORS.map(([id, name, gstin, terms, city, phone]) => ({ id, name, gstin, terms, city, phone })) });
  await prisma.pricingGroup.createMany({ data: Object.entries(MULT).map(([name, multiplier]) => ({ name, multiplier })) });
  await prisma.attributeDef.createMany({ data: [
    { lineId: "L1", key: "community", label: "Community", values: COMMUNITY, portalFacet: true, multiSelect: true, sortOrder: 1 }, { lineId: "L1", key: "occasion", label: "Occasion", values: OCCASION, portalFacet: true, multiSelect: true, sortOrder: 2 },
    { lineId: "L1", key: "paper", label: "Paper", values: PAPER, portalFacet: true, sortOrder: 3 }, { lineId: "L1", key: "size", label: "Size", values: SIZES, portalFacet: true, sortOrder: 4 }, { lineId: "L1", key: "fold", label: "Fold", values: FOLDS, portalFacet: true, sortOrder: 5 },
    { lineId: "L2", key: "machine", label: "Machine fit", values: ["Offset", "Screen", "Flex", "UV"], portalFacet: true, sortOrder: 1 }, { lineId: "L2", key: "brand", label: "Brand", values: ["SGL", "Sicpa", "Varn", "Anchor", "Kinyo", "Ferro", "Ulano", "Techno", "Trelleborg"], portalFacet: true, sortOrder: 2 }, { lineId: "L2", key: "grade", label: "Grade", values: ["Premium", "Standard"], portalFacet: true, sortOrder: 3 },
    { lineId: "L3", key: "material", label: "Material", values: ["Flex", "ACP", "Acrylic", "Non-Woven"], portalFacet: true, sortOrder: 1 }, { lineId: "L3", key: "thickness", label: "Thickness", values: ["440 GSM", "510 GSM", "610 GSM", "3 mm", "4 mm", "5 mm", "90 GSM"], portalFacet: true, sortOrder: 2 }, { lineId: "L3", key: "finish", label: "Finish", values: ["Matte", "Gloss", "Backlit", "Brushed", "Clear", "Milky", "Plain"], portalFacet: true, sortOrder: 3 },
    { lineId: "L4", key: "process", label: "Process", values: ["Offset", "Screen", "Digital", "Foil"], sortOrder: 1 },
    { lineId: null, key: "dealsIn", label: "Deals in", values: ["Cards", "Flex", "ACP", "Acrylic", "Non-Woven"], multiSelect: true, sortOrder: 1 }, { lineId: null, key: "machines", label: "Machines owned", values: ["Offset", "Screen", "Screen by hand", "Flex", "UV"], multiSelect: true, sortOrder: 2 }, { lineId: null, key: "tehsil", label: "Tehsil", values: TEHSILS, portalFacet: true, sortOrder: 3 },
  ] });
  for (const it of makeItems()) await prisma.item.create({ data: it });
  const items = await prisma.item.findMany({ include: { slabs: true, line: true }, orderBy: { id: "asc" } });
  const item = (id: string) => items.find((i) => i.id === id)!;

  // Goods land carrying the manufacturer's label. The office has worked through
  // most of the catalogue re-labelling with its own code; the rest are still on
  // the factory code and show up on the Inventory screen as needing a label.
  const ownCode = (i: { designNo: string | null; sku: string }) => "VC-" + (i.designNo || i.sku).replace(/[^A-Za-z0-9]+/g, "-").toUpperCase();
  const vendorPrefix: Record<string, string> = { "VND-01": "SGP", "VND-02": "RCH", "VND-03": "MPM", "VND-04": "OSP", "VND-05": "SIC", "VND-06": "NPS", "VND-07": "MSS" };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const pre = vendorPrefix[it.vendorId ?? "VND-01"] ?? "MFR";
    const mfr = await prisma.itemCode.create({
      data: { code: `${pre}-${4100 + i * 13}`, itemId: it.id, kind: "MANUFACTURER", status: "ACTIVE", vendorId: it.vendorId, by: "Goods receipt", note: "Label as received from the vendor" },
    });
    // Every fourth item is still waiting to be re-labelled.
    if (i % 4 === 3) continue;
    const own = await prisma.itemCode.create({
      data: { code: ownCode(it), itemId: it.id, kind: "OWN", status: "ACTIVE", by: "Samar Iqbal" },
    });
    await prisma.itemCode.update({ where: { id: mfr.id }, data: { status: "REPLACED", replacedById: own.id, replacedAt: daysAgo(40 - (i % 30)) } });
  }

  const users: Record<string, { id: string; name: string }> = {};
  for (const [username, role, name, initials, isActive] of USERS) users[username] = await prisma.user.create({ data: { username, passwordHash: hash, name, initials, role, isActive } });
  const execs = [users["khadija.sales"], users["samar.purchase"]];

  const custs: { id: string; name: string; group: string; gstin: string; contactName: string; tehsil: string; creditLimit: number; creditDays: number; gateMode: "WARN" | "BLOCK"; username: string | null }[] = [];
  for (let i = 0; i < RAW_CUST.length; i++) {
    const r = RAW_CUST[i];
    const gstin = "08A" + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(66 + (i % 20)) + "CV" + (3400 + i * 13) + "P1Z" + String.fromCharCode(70 + (i % 6));
    const phone = "+91 9" + (4140000000 + i * 713219).toString().slice(0, 9);
    const c = await prisma.customer.create({ data: { id: "CUST-" + (101 + i), name: r[0], contactName: r[1], group: r[2], tehsil: r[3], creditLimit: r[4], creditDays: r[5], gateMode: r[6], linesEnabled: r[8], gstin, firmType: i % 9 === 4 ? "Unregistered" : i % 7 === 3 ? "Composition" : "Registered", phone, address: ["Station Road", "KEM Road", "Rani Bazaar", "Kote Gate", "MG Road", "Gandhi Chowk"][i % 6], referCode: "VIVAHA-" + ["RJ", "BK", "NK", "JD"][i % 4] + (4100 + i * 37), salesExecId: execs[i % 2].id, createdAt: daysAgo(400 - i * 12),
      contacts: { create: [{ name: r[1], role: "Owner", phone, hasLogin: !!r[7], authority: "Owner" }, { name: ["Mohit Vyas", "Salim Khan", "Preeti Joshi", "Anil Godara", "Nasir Ali", "Ritu Sharma"][i % 6], role: "Purchase", phone: "+91 9" + (4180000000 + i * 511777).toString().slice(0, 9), authority: "Staff" }] },
      machines: { create: r[9].map(([type, spec]) => ({ type, spec })) } } });
    if (r[7]) await prisma.user.create({ data: { username: r[7], passwordHash: hash, name: r[1], initials: r[1].split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase(), role: "CUSTOMER", customerId: c.id, authority: "Owner" } });
    custs.push({ id: c.id, name: c.name, group: c.group, gstin, contactName: r[1], tehsil: r[3], creditLimit: r[4], creditDays: r[5], gateMode: r[6], username: r[7] });
  }
  // Seeded firms are CUST-101..CUST-116, so the counter has to start from the
  // same base. Set to the row count alone it would hand out CUST-17 next and,
  // eighty-five customers later, collide with the seeded CUST-101.
  await prisma.sequence.create({ data: { name: "CUST", value: 100 + RAW_CUST.length } });
  await prisma.priceOverride.createMany({ data: [{ customerId: "CUST-102", itemId: "ITM-104", rate: 58, reason: "Long-standing dealer relationship", setBy: "Aadil Bhati" }, { customerId: "CUST-103", itemId: "ITM-110", rate: 71, reason: "Distributor negotiated", setBy: "Aadil Bhati" }] });

  /* stock via GRN */
  let pn = 4180;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; if (it.lineId === "L4") continue;
    const tot = it.lineId === "L1" ? [2400, 3600, 5200, 1800][i % 4] : it.lineId === "L2" ? [120, 240, 80, 160][i % 4] : [4000, 6400, 2400, 3200][i % 4];
    const alloc: Record<string, number> = { "GD-A": Math.round(tot * 0.42), "GD-B": Math.round(tot * 0.33) }; alloc["GD-C"] = tot - alloc["GD-A"] - alloc["GD-B"];
    const cost = Number(it.landedCost);
    const po = await prisma.purchase.create({ data: { id: "PO-" + pn++, vendorId: it.vendorId!, invNo: "PINV-" + (7200 + i * 3), date: daysAgo(150 - ((i * 4) % 140)), freight: Math.round(tot * cost * 0.012), total: tot * cost, gstPct: it.gstPct, status: "POSTED", by: "Samar Iqbal", lines: { create: { itemId: it.id, qty: tot, rate: cost, alloc, batchNo: it.batchTracked ? "B" + (2601 + i * 2) : null } } } });
    for (const gid of Object.keys(alloc)) {
      if (it.batchTracked) { const b1 = "B" + (2601 + i * 2), b2 = "B" + (2602 + i * 2); await stock.receive(prisma, it.id, gid, Math.round(alloc[gid] * 0.6), po.id, "Samar Iqbal", b1, daysAhead(200 - i * 9)); await stock.receive(prisma, it.id, gid, alloc[gid] - Math.round(alloc[gid] * 0.6), po.id, "Samar Iqbal", b2, daysAhead(40 - i * 2)); }
      else await stock.receive(prisma, it.id, gid, alloc[gid], po.id, "Samar Iqbal");
    }
  }
  await prisma.purchase.create({ data: { id: "PO-4301", vendorId: "VND-02", invNo: "PINV-7801", date: daysAgo(3), eta: daysAhead(6), freight: 2400, total: 1800 * Number(item("ITM-120").landedCost), gstPct: 12, status: "IN_TRANSIT", by: "Samar Iqbal", lines: { create: { itemId: "ITM-120", qty: 1800, rate: Number(item("ITM-120").landedCost), alloc: {} } } } });
  await prisma.sequence.create({ data: { name: "PO", value: 4301 } });
  for (const v of VENDORS) { const ps = await prisma.purchase.findMany({ where: { vendorId: v[0] } }); const inv = ps.reduce((s, p) => s + Number(p.total) + Number(p.freight), 0); const f = [0.9, 0.72, 1, 0.55, 0.83, 0.95, 0.68][VENDORS.indexOf(v) % 7]; if (inv) await prisma.vendorPayment.create({ data: { vendorId: v[0], date: daysAgo(20), amount: Math.round(inv * f), ref: "VPAY-" + v[0] } }); }

  /* drain a few SKUs so every band is visible */
  const drain = async (iid: string, keep: number) => { for (const g of GODOWNS) await prisma.stockBalance.updateMany({ where: { itemId: iid, godownId: g.id }, data: { onHand: g.id === "GD-A" ? keep : 0 } }); };
  await drain("ITM-120", 0); await drain("ITM-114", 0); await drain("ITM-108", 180); await drain("ITM-105", 900); await drain("ITM-206", 14);
  await stock.adjust(prisma, "ITM-109", "GD-B", 240, "damage", "Monsoon seepage — Godown B north wall, 8 boxes affected", "Devendra Suthar");
  await stock.adjust(prisma, "ITM-103", "GD-A", 60, "damage", "Corner crush during forklift handling", "Devendra Suthar");
  await stock.adjust(prisma, "ITM-213", "GD-C", 18, "quarantine", "Batch B2627 within 40 days of expiry — held for liquidation", "Devendra Suthar");

  /* transfers */
  for (const t of [["TRF-2201", "ITM-102", "GD-A", "GD-C", 400, "Devendra Suthar", 2], ["TRF-2202", "ITM-207", "GD-B", "GD-A", 40, "Khadija Ansari", 1]] as const) {
    const batch = await stock.issue(prisma, t[1], t[2], t[4], t[0], t[5]);
    await prisma.transfer.create({ data: { id: t[0], itemId: t[1], fromId: t[2], toId: t[3], qty: t[4], batchNo: batch, by: t[5], at: daysAgo(t[6]) } });
  }
  await prisma.transfer.create({ data: { id: "TRF-2199", itemId: "ITM-106", fromId: "GD-C", toId: "GD-B", qty: 600, status: "RECEIVED", by: "Devendra Suthar", at: daysAgo(9), receivedAt: daysAgo(7) } });
  await prisma.sequence.create({ data: { name: "TRF", value: 2202 } });

  /* orders */
  await prisma.sequence.create({ data: { name: "INV-" + fy(), value: 411 } });
  const plan: [number, string, string[], number, number][] = [[0, "DELIVERED", ["L1"], 38, -20], [1, "DELIVERED", ["L1", "L2"], 34, -18], [2, "DELIVERED", ["L1"], 30, -14], [6, "DELIVERED", ["L1"], 27, -12], [7, "DELIVERED", ["L1"], 24, -10], [8, "DELIVERED", ["L1", "L2"], 21, -8], [3, "DISPATCHED", ["L1"], 9, 3], [5, "DISPATCHED", ["L1"], 7, 4], [1, "PARTIALLY_DISPATCHED", ["L1"], 6, 5], [2, "READY_TO_DISPATCH", ["L1", "L2"], 5, 6], [9, "PACKED", ["L1"], 4, 7], [10, "PICKING", ["L1"], 4, 9], [11, "ALLOCATED", ["L1"], 3, 11], [12, "RESERVED", ["L1", "L3", "L5"], 3, 13], [13, "APPROVED", ["L1"], 2, 14], [0, "BOOKED", ["L1"], 0, 6], [4, "BOOKED", ["L1"], 0, 9], [14, "BOOKED", ["L1"], 0, 16], [15, "BOOKED", ["L1", "L2"], 0, 12], [3, "REJECTED", ["L1"], 12, 0], [5, "LAPSED", ["L1"], 5, 0], [9, "CANCELLED", ["L1"], 16, 0]];
  let on = 1061;
  const WHY: Record<string, string> = { RESERVED: "Temporary hold converted to firm reservation", ALLOCATED: "Godown allocation confirmed", PICKING: "Pick list generated", PICKED: "All lines picked", PACKED: "Packed into boxes", READY_TO_DISPATCH: "Staged at dispatch bay", DISPATCHED: "Dispatched via transporter", DELIVERED: "Delivery confirmed by customer" };
  const WHO: Record<string, string> = { RESERVED: "Khadija Ansari", ALLOCATED: "Devendra Suthar", PICKING: "Devendra Suthar", PICKED: "Devendra Suthar", PACKED: "Devendra Suthar", READY_TO_DISPATCH: "Farhan Sheikh", DISPATCHED: "Farhan Sheikh", DELIVERED: "Office" };
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i], c = custs[p[0]], status = p[1] as OrderStatus;
    const lines: { itemId: string; lineId: string; qty: number; rate: number; slabRate: number; mult: number; priceSrc: string; amount: number; gstPct: number; hsn: string; alloc: Record<string, number>; shipped: number }[] = [];
    for (let li = 0; li < p[2].length; li++) {
      const lid = p[2][li]; const pool = items.filter((x) => x.lineId === lid && x.status === "ACTIVE"); const n = lid === "L1" ? 1 + (i % 3) : 1;
      for (let j = 0; j < n; j++) {
        const it = pool[(i * 5 + j * 3 + li * 7) % pool.length];
        let q = lid === "L1" ? [250, 500, 750, 1200, 2200][(i + j) % 5] : lid === "L2" ? [10, 25, 40, 60][(i + j) % 4] : [400, 800, 1200][(i + j) % 3];
        const best = Math.max(...(await Promise.all(GODOWNS.map((g) => stock.availGodown(prisma, it.id, g.id)))));
        if (best < q) q = Math.floor(best / it.moq) * it.moq; if (q < it.moq) continue;
        const ov = (c.id === "CUST-102" && it.id === "ITM-104") ? 58 : (c.id === "CUST-103" && it.id === "ITM-110") ? 71 : null;
        const pr = priceFor({ id: it.id, landedCost: Number(it.landedCost), moq: it.moq, slabs: it.slabs.map((s) => ({ fromQty: s.fromQty, toQty: s.toQty, rate: Number(s.rate) })) }, MULT[c.group], q, ov);
        lines.push({ itemId: it.id, lineId: lid, qty: q, rate: pr.rate, slabRate: pr.slab, mult: pr.mult, priceSrc: pr.src, amount: q * pr.rate, gstPct: it.gstPct, hsn: it.hsn, alloc: {}, shipped: 0 });
      }
    }
    if (!lines.length) continue;
    const tot = invoiceTotals(lines, c.gstin);
    const id = "ORD-" + on++; const created = daysAgo(p[3]);
    const events: { from: string | null; to: string; by: string; why: string; at: Date }[] = [{ from: null, to: "BOOKED", by: c.contactName, at: created, why: "Booked via wholesale portal" }];
    const step = (to: string, by: string, day: number, why: string) => events.push({ from: events[events.length - 1].to, to, by, at: daysAgo(Math.max(0, day)), why });
    let finalStatus = status, approvedAt: Date | null = null, holdUntil: Date | null = null;
    const idx = ORDER_FLOW.indexOf(status); const advanced = idx > 0 || status === "PARTIALLY_DISPATCHED";
    if (advanced) {
      approvedAt = daysAgo(Math.max(0, p[3] - 1)); step("APPROVED", "Khadija Ansari", p[3] - 1, "Credit and stock verified");
      if (idx >= 2 || status === "PARTIALLY_DISPATCHED") {
        let ok = true;
        for (const l of lines) {
          const gid = GODOWNS[(i + l.itemId.length) % 3].id;
          let use: string | undefined = (await stock.availGodown(prisma, l.itemId, gid)) >= l.qty ? gid : undefined;
          if (!use) for (const g of GODOWNS) if ((await stock.availGodown(prisma, l.itemId, g.id)) >= l.qty) { use = g.id; break; }
          if (!use) { ok = false; break; }
          l.alloc = { [use]: l.qty };
          const r = await stock.tryHold(prisma, l.itemId, l.alloc, id, "Khadija Ansari"); if (!r.ok) { ok = false; break; }
          await stock.holdToReserved(prisma, l.itemId, l.alloc, id, "Khadija Ansari");
        }
        if (!ok) { for (const l of lines) if (Object.keys(l.alloc).length) { await stock.releaseReserved(prisma, l.itemId, l.alloc, id, "seed rollback", "System"); l.alloc = {}; } finalStatus = "APPROVED"; }
        else {
          const target = status === "PARTIALLY_DISPATCHED" ? "READY_TO_DISPATCH" : status; const ti = ORDER_FLOW.indexOf(target);
          ORDER_FLOW.slice(2, ti + 1).forEach((st, x) => step(st, WHO[st] || "Office", p[3] - 2 - x * 0.4, WHY[st] || ""));
          if (status === "PARTIALLY_DISPATCHED") step("PARTIALLY_DISPATCHED", "Farhan Sheikh", Math.max(0, p[3] - 3), "Partial dispatch — balance stays reserved as a backorder");
        }
      }
    }
    if (status === "BOOKED") {
      for (const l of lines) {
        const gid = GODOWNS[(i + l.itemId.length) % 3].id;
        let use: string | undefined = (await stock.availGodown(prisma, l.itemId, gid)) >= l.qty ? gid : undefined;
        if (!use) for (const g of GODOWNS) if ((await stock.availGodown(prisma, l.itemId, g.id)) >= l.qty) { use = g.id; break; }
        if (!use) continue;
        l.alloc = { [use]: l.qty }; if (!(await stock.tryHold(prisma, l.itemId, l.alloc, id, c.contactName)).ok) l.alloc = {};
      }
      holdUntil = minsAhead([4, 11, 18, 26][i % 4]);
    }
    if (status === "LAPSED") step("LAPSED", "System", p[3], "Hold expired before office approval — alert raised to Khadija Ansari");
    if (status === "REJECTED") step("REJECTED", "Rahin Qureshi", p[3], "Credit limit breached and oldest invoice 61 days overdue");
    if (status === "CANCELLED") step("CANCELLED", c.contactName, p[3], "Customer cancelled — wedding date changed");
    const ship = ["DISPATCHED", "DELIVERED", "PARTIALLY_DISPATCHED"].includes(finalStatus) && lines.some((l) => Object.keys(l.alloc).length);
    const o = await prisma.order.create({ data: { id, customerId: c.id, status: finalStatus, subtotal: tot.taxable, tax: tot.tax, total: tot.total, requiredBy: daysAhead(p[4]), createdAt: created, approvedAt, holdUntil, bookedBy: p[0] < 3 ? c.contactName : "Khadija Ansari (assisted)", source: p[0] < 3 ? "portal" : "office", lines: { create: lines }, events: { create: events } } });
    if (ship) {
      const shipped: { itemId: string; qty: number; godownId: string }[] = [];
      const lrows = await prisma.orderLine.findMany({ where: { orderId: id } });
      for (const l of lrows) {
        const alloc = l.alloc as Record<string, number>; const gid = Object.keys(alloc)[0]; if (!gid) continue;
        const q = finalStatus === "PARTIALLY_DISPATCHED" ? Math.round(l.qty * 0.6) : l.qty;
        await stock.shipReserved(prisma, l.itemId, { [gid]: q }, id, "Farhan Sheikh"); alloc[gid] -= q;
        await prisma.orderLine.update({ where: { id: l.id }, data: { shipped: q, alloc } }); shipped.push({ itemId: l.itemId, qty: q, godownId: gid });
      }
      const at = daysAgo(Math.max(0, p[3] - 2));
      const invLines = lrows.filter((l) => shipped.find((s) => s.itemId === l.itemId)).map((l) => { const q = shipped.find((s) => s.itemId === l.itemId)!.qty; return { l, qty: q, amount: q * Number(l.rate) }; });
      const t = invoiceTotals(invLines.map((x) => ({ amount: x.amount, gstPct: x.l.gstPct })), c.gstin);
      const no = await nextInvoiceNo(prisma);
      await prisma.invoice.create({ data: { no, orderId: id, customerId: c.id, date: at, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, blocks: t.blocks as unknown as Prisma.InputJsonValue, lines: { create: invLines.map((x) => ({ itemId: x.l.itemId, itemName: item(x.l.itemId).name, sku: item(x.l.itemId).sku, hsn: x.l.hsn, qty: x.qty, rate: x.l.rate, amount: x.amount, gstPct: x.l.gstPct })) } } });
      await prisma.ledgerEntry.create({ data: { customerId: c.id, date: at, type: "INVOICE", ref: no, particular: `Tax Invoice ${no} · ${id}`, debit: t.total, credit: 0 } });
      await prisma.dispatch.create({ data: { orderId: id, transporter: ["Rajasthan Roadways Cargo", "Marudhar Transport Co.", "Bikaner Fast Freight", "Shree Balaji Carriers"][i % 4], lr: "LR-" + (55120 + i * 17), tracking: "TRK" + (904100 + i * 271), packages: lines.length + 1, freight: 400 + i * 35, lines: shipped, invoiceNo: no, at, by: "Farhan Sheikh" } });
    }
    void o;
  }
  await prisma.sequence.create({ data: { name: "ORD", value: on - 1 } });

  /* opening balances + payments */
  let rc = 3300;
  for (let i = 0; i < custs.length; i++) {
    const c = custs[i]; const op = [18000, 42000, 0, 96000, 0, 31000][i % 6];
    if (op) await prisma.ledgerEntry.create({ data: { customerId: c.id, date: daysAgo(210), type: "OPENING", ref: "OB", particular: "Opening balance carried forward", debit: op, credit: 0 } });
    if (i % 2 === 0) { const amt = [25000, 60000, 18000, 40000][i % 4], d = daysAgo(20 - (i % 12)), m = ["UPI", "NEFT", "Cheque", "Cash"][i % 4]; const id = "RCPT-" + rc++; await prisma.payment.create({ data: { id, customerId: c.id, date: d, amount: amt, method: m, ref: "REF" + (880100 + i * 37), by: "Rahin Qureshi" } }); await prisma.ledgerEntry.create({ data: { customerId: c.id, date: d, type: "PAYMENT", ref: id, particular: "Payment received · " + m, debit: 0, credit: amt } }); }
  }
  await prisma.sequence.create({ data: { name: "RCPT", value: rc - 1 } });
  await prisma.ledgerEntry.create({ data: { customerId: "CUST-104", date: daysAgo(74), type: "INVOICE", ref: "VC/26-27/0388", particular: "Tax Invoice VC/26-27/0388 · ORD-1042", debit: 118400, credit: 0 } });

  /* kits */
  const activeCards = items.filter((i) => i.lineId === "L1" && i.status === "ACTIVE").map((i) => i.id);
  await prisma.kitVersion.create({ data: { id: "KIT-2026-S1", name: "Kit 2026 · Season 1", issuedAt: daysAgo(200), items: { create: items.filter((i) => i.lineId === "L1").slice(0, 20).map((i) => ({ itemId: i.id })) } } });
  await prisma.kitVersion.create({ data: { id: "KIT-2026-S2", name: "Kit 2026 · Season 2", issuedAt: daysAgo(120), items: { create: activeCards.map((id) => ({ itemId: id })) } } });
  await prisma.kit.createMany({ data: [{ customerId: "CUST-101", kitVersionId: "KIT-2026-S2", issuedAt: daysAgo(120), lastScanAt: daysAgo(60) }, { customerId: "CUST-102", kitVersionId: "KIT-2026-S2", issuedAt: daysAgo(100) }, { customerId: "CUST-103", kitVersionId: "KIT-2026-S1", issuedAt: daysAgo(80) }] });

  /* returns, jobs, ads, referrals */
  await prisma.returnRequest.createMany({ data: [
    { id: "RET-3101", orderId: "ORD-1061", customerId: "CUST-101", itemId: "ITM-101", qty: 120, reason: "Print smudge on inner leaf — 120 pcs of 500", status: "INSPECTION", createdAt: daysAgo(5), hasPhoto: true },
    { id: "RET-3102", orderId: "ORD-1062", customerId: "CUST-102", itemId: "ITM-106", qty: 40, reason: "Wrong fold shipped — Trifold instead of Double Fold", status: "ACCEPTED", outcome: "Good stock", createdAt: daysAgo(13), resolvedAt: daysAgo(10), creditAmount: 3480, creditNoteNo: "CN/26-27/0119", godownId: "GD-A" },
    { id: "RET-3103", orderId: "ORD-1063", customerId: "CUST-103", itemId: "ITM-112", qty: 25, reason: "Corner damage in transit, box 3 of 6", status: "REQUESTED", createdAt: daysAgo(1), hasPhoto: true },
  ] });
  await prisma.ledgerEntry.create({ data: { customerId: "CUST-102", date: daysAgo(10), type: "CREDIT", ref: "CN/26-27/0119", particular: "Credit Note CN/26-27/0119 · return RET-3102", debit: 0, credit: 3480 } });
  await prisma.sequence.createMany({ data: [{ name: "RET", value: 3103 }, { name: "CN-" + fy(), value: 119 }, { name: "JOB", value: 5103 }, { name: "REF", value: 3 }] });
  await prisma.jobWork.createMany({ data: [
    { id: "JOB-5101", customerId: "CUST-101", baseItemId: "ITM-101", processItemId: "ITM-401", qty: 600, status: "PROOF_SENT", requiredBy: daysAhead(9), text: "Vikram weds Anjali · 28 Nov 2026 · Hotel Lallgarh Palace, Bikaner", quote: 34800, proofs: 2, createdAt: daysAgo(3) },
    { id: "JOB-5102", customerId: "CUST-108", baseItemId: "ITM-108", processItemId: "ITM-402", qty: 1200, status: "PRINTING", requiredBy: daysAhead(5), text: "Rekha weds Sanjay · 02 Dec 2026 · Rani Sati Bhawan", quote: 71200, proofs: 1, approvedAt: daysAgo(2), createdAt: daysAgo(6) },
    { id: "JOB-5103", customerId: "CUST-114", baseItemId: "ITM-104", processItemId: "ITM-405", qty: 400, status: "QUOTED", requiredBy: daysAhead(18), text: "Ismail weds Farah · 14 Dec 2026 · Pushkar Garden Resort", quote: 28600, proofs: 0, createdAt: daysAgo(1) },
  ] });
  await prisma.ad.createMany({ data: [
    { id: "AD-01", title: "Marudhar Paper Mills — Monsoon offer", sub: "300gsm art card, ₹4/sheet off on 10+ reams", target: {}, impressions: 1842, taps: 96 },
    { id: "AD-02", title: "Sunlite UV Coating Machines", sub: "Add UV finishing in-house · EMI from ₹18,400/mo", target: { noMachine: "UV" }, impressions: 640, taps: 71 },
    { id: "AD-03", title: "SGL Inks — bulk rate this week", sub: "Process set 4×5kg at ₹1,580 · limited", target: { machine: "Offset" }, impressions: 1120, taps: 58 },
  ] });
  await prisma.referral.createMany({ data: [
    { id: "REF-01", byId: "CUST-101", name: "Marwar Card Bhandar", tehsil: "Nokha", phone: "+91 94141 20038", state: "Reward released", reward: 2000, createdAt: daysAgo(40) },
    { id: "REF-02", byId: "CUST-101", name: "Nokha Stationers", tehsil: "Nokha", phone: "+91 94183 55210", state: "First order pending", reward: 2000, createdAt: daysAgo(12) },
    { id: "REF-03", byId: "CUST-101", name: "Churu Card House", tehsil: "Churu", phone: "+91 94602 71144", state: "Contacted", reward: 2000, createdAt: daysAgo(4) },
  ] });
  for (const [it, cu] of [["ITM-108", "CUST-105"], ["ITM-108", "CUST-111"], ["ITM-114", "CUST-101"], ["ITM-120", "CUST-102"], ["ITM-120", "CUST-107"], ["ITM-206", "CUST-102"]]) await prisma.stockoutSearch.create({ data: { itemId: it, customerId: cu, reqQty: item(it).moq * 4, availQty: 0, at: daysAgo(3) } });

  const notifs: [string, "WARN" | "OK" | "INFO" | "ERR"][] = [["4 bookings awaiting approval — 1 hold expires in under 5 minutes", "WARN"], ["ORD-1081 hold lapsed — stock released, alert raised to Khadija Ansari", "WARN"], ["Stock below full set: WC-1045 · 180 pcs across all godowns", "WARN"], ["Payment ₹60,000 received from Rajputana Cards & Gifts", "OK"], ["TRF-2201 pending receipt at Godown C — 400 pcs in transit", "INFO"], ["RET-3103 return request raised by Golden Invites Bikaner", "INFO"], ["Marwar Shaadi Bazaar — oldest invoice 74 days, credit gate will block", "ERR"]];
  for (const [text, kind] of notifs) await prisma.notification.create({ data: { text, kind, role: "SUPER_ADMIN" } });
  await prisma.auditLog.createMany({ data: [
    { actor: "Devendra Suthar", action: "Stock damage adjustment", entityType: "Item", entityId: "WC-1051", oldValue: "0 damaged", newValue: "240 damaged", reason: "Monsoon seepage — Godown B north wall" },
    { actor: "Aadil Bhati", action: "Customer price override set", entityType: "Customer", entityId: "Rajputana Cards & Gifts", oldValue: "—", newValue: "WC-1033 = ₹58", reason: "Long-standing dealer relationship" },
    { actor: "Rahin Qureshi", action: "Order rejected", entityType: "Order", entityId: "ORD-1080", oldValue: "Booked", newValue: "Rejected", reason: "Credit limit breached and oldest invoice 61 days overdue" },
    { actor: "System", action: "Reservation auto-released", entityType: "Order", entityId: "ORD-1081", oldValue: "Booked", newValue: "Lapsed", reason: "Hold expired before office approval" },
    { actor: "Aadil Bhati", action: "Pricing multiplier reviewed", entityType: "Settings", entityId: "Default multipliers", oldValue: "Regular 1.25×", newValue: "No change", reason: "Quarterly pricing review" },
  ] });
  console.log(`Seeded: ${items.length} items, ${custs.length} firms, ${on - 1061} orders. Login: admin / ${PASSWORD} · portal: sharma_wedding / ${PASSWORD}`);
}
function fy() { const y = TODAY.getMonth() >= 3 ? TODAY.getFullYear() : TODAY.getFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; }

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
