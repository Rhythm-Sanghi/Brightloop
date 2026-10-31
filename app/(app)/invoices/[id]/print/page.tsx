import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/guard';
import Decimal from 'decimal.js';

interface PrintInvoicePageProps {
  params: Promise<{ id: string }>;
}

export default async function PrintInvoicePage({ params }: PrintInvoicePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      subscription: {
        include: { plan: true },
      },
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: { product: true, variant: true },
      },
      discounts: {
        include: { discount: true },
      },
      payments: true,
    },
  });

  if (!invoice) {
    notFound();
  }

  // If customer logged in, verify ownership
  if (session.role === 'CUSTOMER') {
    if (!session.customerId || invoice.customerId !== session.customerId) {
      notFound();
    }
  }

  const totalDec = new Decimal(invoice.total);
  const paidDec = new Decimal(invoice.amountPaid);
  const balanceDec = totalDec.minus(paidDec);

  return (
    <div className="min-h-screen bg-white text-black p-8 max-w-4xl mx-auto print:p-0 print:max-w-none">
      {/* Screen action bar - hidden on print */}
      <div className="flex justify-between items-center mb-8 pb-4 border-b print:hidden">
        <span className="text-sm text-gray-500">
          Print Preview • Invoice {invoice.number || 'Draft'}
        </span>
        <button
          onClick={() => {}}
          className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 cursor-pointer"
          id="print-btn"
        >
          Print Invoice
        </button>
      </div>

      {/* Printable Invoice Container */}
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start border-b pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-indigo-900">
              BRIGHTLOOP SOFTWARE
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              Subscription Management Platform
              <br />
              123 Innovation Boulevard, Cyber City, Bangalore 560100
              <br />
              GSTIN: 29AABCB1234F1Z5
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold uppercase tracking-wider text-gray-800">
              Tax Invoice
            </h2>
            <div className="text-sm font-mono mt-1 font-semibold text-gray-900">
              {invoice.number || 'DRAFT INVOICE'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Status:{' '}
              <span className="font-semibold uppercase text-gray-800">
                {invoice.status}
              </span>
            </div>
          </div>
        </div>

        {/* Invoice & Customer Info */}
        <div className="grid grid-cols-2 gap-8 text-sm">
          <div>
            <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider">
              Billed To:
            </h3>
            <div className="font-bold text-gray-900 text-base mt-1">
              {invoice.customer.name}
            </div>
            <div className="text-gray-600 text-xs mt-0.5">{invoice.customer.email}</div>
            {invoice.customer.company && (
              <div className="text-gray-600 text-xs">{invoice.customer.company}</div>
            )}
            {invoice.customer.phone && (
              <div className="text-gray-600 text-xs">Phone: {invoice.customer.phone}</div>
            )}
          </div>
          <div className="space-y-1 text-right text-xs">
            <div>
              <span className="text-gray-500">Subscription: </span>
              <span className="font-semibold text-gray-900 font-mono">
                {invoice.subscription.number || invoice.subscription.id.slice(0, 8)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Plan: </span>
              <span className="font-medium text-gray-900">
                {invoice.subscription.plan.name}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Issue Date: </span>
              <span className="font-medium text-gray-900">
                {new Date(invoice.issueDate).toISOString().split('T')[0]}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Due Date: </span>
              <span className="font-medium text-gray-900">
                {new Date(invoice.dueDate).toISOString().split('T')[0]}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Billing Period: </span>
              <span className="font-medium text-gray-900">
                {new Date(invoice.periodStart).toISOString().split('T')[0]} to{' '}
                {new Date(invoice.periodEnd).toISOString().split('T')[0]}
              </span>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-y border-gray-300 bg-gray-50">
              <th className="py-2.5 px-2 font-semibold text-gray-700">Description</th>
              <th className="py-2.5 px-2 text-center font-semibold text-gray-700">Qty</th>
              <th className="py-2.5 px-2 text-right font-semibold text-gray-700">Unit Price</th>
              <th className="py-2.5 px-2 text-right font-semibold text-gray-700">Discount</th>
              <th className="py-2.5 px-2 text-right font-semibold text-gray-700">Taxable</th>
              <th className="py-2.5 px-2 text-right font-semibold text-gray-700">GST %</th>
              <th className="py-2.5 px-2 text-right font-semibold text-gray-700">Tax Amt</th>
              <th className="py-2.5 px-2 text-right font-semibold text-gray-700">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {invoice.lines.map((l) => {
              const lineTotal = (
                parseFloat(l.taxableAmount.toString()) +
                parseFloat(l.taxAmount.toString())
              ).toFixed(2);
              return (
                <tr key={l.id}>
                  <td className="py-2 px-2 font-medium">
                    {l.product.name}
                    {l.variant && (
                      <span className="block text-[11px] text-gray-500">
                        Variant: {l.variant.attribute}: {l.variant.value}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">{l.quantity}</td>
                  <td className="py-2 px-2 text-right">
                    ₹{parseFloat(l.unitPrice.toString()).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-600">
                    {parseFloat(l.allocatedDiscount.toString()) > 0
                      ? `-₹${parseFloat(l.allocatedDiscount.toString()).toFixed(2)}`
                      : '₹0.00'}
                  </td>
                  <td className="py-2 px-2 text-right">
                    ₹{parseFloat(l.taxableAmount.toString()).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {parseFloat(l.taxRatePercent.toString())}%
                  </td>
                  <td className="py-2 px-2 text-right">
                    ₹{parseFloat(l.taxAmount.toString()).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right font-semibold">₹{lineTotal}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totals Section */}
        <div className="flex justify-end pt-4">
          <div className="w-64 space-y-1.5 text-xs">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal:</span>
              <span>₹{parseFloat(invoice.subtotal.toString()).toFixed(2)}</span>
            </div>
            {parseFloat(invoice.discountTotal.toString()) > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Discounts:</span>
                <span>-₹{parseFloat(invoice.discountTotal.toString()).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Taxable Total:</span>
              <span>₹{parseFloat(invoice.taxableTotal.toString()).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>GST Tax:</span>
              <span>₹{parseFloat(invoice.taxTotal.toString()).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-300 pt-2 font-bold text-sm text-gray-900">
              <span>Total Amount:</span>
              <span>₹{parseFloat(invoice.total.toString()).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-700">
              <span>Amount Paid:</span>
              <span>₹{parseFloat(invoice.amountPaid.toString()).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-300 pt-1 font-bold text-sm text-gray-900">
              <span>Balance Due:</span>
              <span>₹{balanceDec.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Remittance & Payment Details */}
        <div className="border-t border-gray-200 pt-6 mt-8 grid grid-cols-2 gap-4 text-xs text-gray-600">
          <div>
            <h4 className="font-semibold text-gray-800 mb-1">Payment Instructions</h4>
            <p>Please remit payments to:</p>
            <p className="font-mono mt-0.5">
              Bank: HDFC Bank
              <br />
              Account Name: Brightloop Software Pvt Ltd
              <br />
              Account No: 50200012345678
              <br />
              IFSC: HDFC0001234
            </p>
          </div>
          <div className="text-right">
            <p className="italic text-gray-400 mt-6">
              Thank you for subscribing to Brightloop Software!
            </p>
          </div>
        </div>

        {/* Simulated disclaimer */}
        <div className="border-t border-dashed border-gray-300 pt-3 text-[10px] text-center text-gray-400">
          Demonstration Invoice generated for Brightloop Subscription Management. Delivery is simulated.
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.getElementById('print-btn')?.addEventListener('click', function() {
              window.print();
            });
          `,
        }}
      />
    </div>
  );
}
