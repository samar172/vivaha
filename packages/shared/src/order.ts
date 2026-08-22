export const ORDER_STATUSES = [
  "BOOKED", "APPROVED", "RESERVED", "ALLOCATED", "PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH",
  "PARTIALLY_DISPATCHED", "DISPATCHED", "DELIVERED", "LAPSED", "REJECTED", "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_FLOW: OrderStatus[] = [
  "BOOKED", "APPROVED", "RESERVED", "ALLOCATED", "PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED",
];
export const ORDER_CLOSED: OrderStatus[] = ["LAPSED", "REJECTED", "CANCELLED"];
export const ORDER_ACTIVE: OrderStatus[] = ["APPROVED", "RESERVED", "ALLOCATED", "PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH"];
export const ORDER_SHIPPED: OrderStatus[] = ["PARTIALLY_DISPATCHED", "DISPATCHED", "DELIVERED"];
export const ORDER_DISPATCH_QUEUE: OrderStatus[] = ["ALLOCATED", "PICKING", "PICKED", "PACKED", "READY_TO_DISPATCH", "PARTIALLY_DISPATCHED"];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  BOOKED: "Booked", APPROVED: "Approved", RESERVED: "Reserved", ALLOCATED: "Allocated", PICKING: "Picking", PICKED: "Picked",
  PACKED: "Packed", READY_TO_DISPATCH: "Ready to Dispatch", PARTIALLY_DISPATCHED: "Partially Dispatched", DISPATCHED: "Dispatched",
  DELIVERED: "Delivered", LAPSED: "Lapsed", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
export const ORDER_STATUS_HI: Record<OrderStatus, string> = {
  BOOKED: "मंज़ूरी बाकी", APPROVED: "मंज़ूर", RESERVED: "स्टॉक रुका", ALLOCATED: "गोदाम तय", PICKING: "निकाला जा रहा", PICKED: "निकल गया",
  PACKED: "पैक हुआ", READY_TO_DISPATCH: "भेजने को तैयार", PARTIALLY_DISPATCHED: "आधा भेजा", DISPATCHED: "भेज दिया",
  DELIVERED: "पहुँच गया", LAPSED: "समय ख़त्म", REJECTED: "अस्वीकार", CANCELLED: "रद्द",
};

export function orderProgress(s: OrderStatus): number {
  const i = ORDER_FLOW.indexOf(s);
  return i >= 0 ? (i + 1) / ORDER_FLOW.length : s === "PARTIALLY_DISPATCHED" ? 0.85 : 0;
}

export const RETURN_STATUSES = ["REQUESTED", "INSPECTION", "ACCEPTED", "REJECTED"] as const;
export const JOB_STATUSES = ["ENQUIRY", "QUOTED", "ACCEPTED", "PROOF_SENT", "APPROVED_PROOF", "PRINTING", "QC", "READY", "DELIVERED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  ENQUIRY: "Enquiry", QUOTED: "Quoted", ACCEPTED: "Accepted", PROOF_SENT: "Proof Sent", APPROVED_PROOF: "Approved Proof",
  PRINTING: "Printing", QC: "QC", READY: "Ready", DELIVERED: "Delivered",
};
