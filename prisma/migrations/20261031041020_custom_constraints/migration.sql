CREATE UNIQUE INDEX "SubscriptionRequest_one_pending"
  ON "SubscriptionRequest" ("subscriptionId", "requestType")
  WHERE "status" = 'PENDING';

INSERT INTO "SubscriptionCounter" ("id", "lastValue") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_valid"
  CHECK ("total" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total");

ALTER TABLE "Discount" ADD CONSTRAINT "Discount_percent_range"
  CHECK ("kind" <> 'PERCENT' OR ("value" > 0 AND "value" <= 100));

ALTER TABLE "Discount" ADD CONSTRAINT "Discount_fixed_positive"
  CHECK ("kind" <> 'FIXED' OR "value" > 0);

CREATE UNIQUE INDEX "Customer_email_lower_key" ON "Customer" (lower("email"));
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
