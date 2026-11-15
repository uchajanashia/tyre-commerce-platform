/** Internal operations read model. Money uses the existing whole-GEL contract. */
export type OperationsView =
  "orders" | "payments" | "customers" | "inventory" | "vehicles";
export interface OperationsRow {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  amount: number | null;
  currency?: string;
  quantity: number | null;
  updatedAt: string;
  details: { label: string; value: string }[];
  modelId?: string;
  classification?: string;
  fulfillmentStatus?: string;
}
export interface OperationsPage {
  items: OperationsRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface OperationsSummary {
  orders: {
    total: number;
    pending: number;
    paid: number;
    paidAmount: number;
  } | null;
  catalog: {
    products: number;
    unknownStock: number;
    withoutPhotos: number;
  } | null;
  updatedAt: string;
}
export interface VehicleAssignment {
  classification: string;
  expectedUpdatedAt: string;
}

export interface WorkflowItem {
  id: string;
  name: string;
  code: string;
  quantity: number;
  issued: number;
  returned: number;
}
export interface WorkflowRefund {
  id: string;
  amountMinor: number;
  state: string;
  reason: string;
  createdAt: string;
}
export interface OrderWorkflow {
  id: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalMinor: number;
  refundedMinor: number;
  refundableMinor: number;
  expiresAt: string | null;
  items: WorkflowItem[];
  refunds: WorkflowRefund[];
}
export interface WorkflowConfig {
  enabled: boolean;
  refundsEnabled: boolean;
  warehouse: string;
}
export interface StockHistory {
  id: string;
  kind: string;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  createdAt: string;
}
export interface ItemMovementCommand {
  requestId: string;
  items: { orderItemId: string; quantity: number }[];
}
export interface RefundCommand {
  requestId: string;
  amountMinor: number;
  reason: string;
}
export interface StockCountCommand {
  requestId: string;
  quantity: number;
  expectedUpdatedAt: string;
  reason: string;
}
