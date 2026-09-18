"use client";

import { use, useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { loadBusinessSaleTicketAction, type BusinessSaleTicket } from "../../actions";

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

const PAYMENT_METHOD_LABEL: Record<"cash" | "transfer", string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
};

interface TicketPageProps {
  params: Promise<{ saleId: string }>;
}

export default function SaleTicketPage({ params }: TicketPageProps) {
  const { saleId } = use(params);
  const [ticket, setTicket] = useState<BusinessSaleTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadBusinessSaleTicketAction(saleId).then((result) => {
      if (!active) return;
      if (result.success) { setTicket(result.ticket); setError(null); }
      else { setTicket(null); setError(result.error); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [saleId]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-500"><Loader2 className="animate-spin" /></div>;
  }
  if (error || !ticket) {
    return <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-red-300">{error || "No se pudo cargar el ticket."}</div>;
  }

  const { sale } = ticket;
  const unitsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="mx-auto max-w-sm bg-white px-2 py-6 text-black print:max-w-none print:p-0">
      <div className="mb-4 flex justify-center gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-stampa-orange px-5 text-sm font-bold text-white"><Printer size={16} /> Imprimir</button>
      </div>

      <div id="sale-ticket" className="mx-auto w-full max-w-[320px] font-mono text-[12px] leading-5 text-black print:max-w-[80mm]">
        <div className="text-center">
          <p className="text-sm font-bold uppercase">{ticket.businessName}</p>
          <p className="mt-1">{dateTime.format(new Date(sale.created_at))}</p>
          <p>Venta N.º {sale.sale_number}</p>
          {sale.status === "voided" && <p className="mt-1 font-bold uppercase">Anulada</p>}
        </div>

        <div className="my-2 border-t border-dashed border-black" />

        <p>Cliente: {sale.client_name ?? "Consumidor final"}</p>

        <div className="my-2 border-t border-dashed border-black" />

        {sale.items.map((item) => (
          <div key={item.id} className="mb-1.5 flex justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{item.product_name_snapshot}</span>
              <span className="block text-[11px]">{item.quantity} × {money.format(item.unit_price)}</span>
            </span>
            <span className="shrink-0">{money.format(item.subtotal)}</span>
          </div>
        ))}

        <div className="my-2 border-t border-dashed border-black" />

        <div className="flex justify-between text-[13px] font-bold"><span>Total ({unitsSold} u.)</span><span>{money.format(sale.total)}</span></div>

        <div className="my-2 border-t border-dashed border-black" />

        <p className="font-bold">Pago</p>
        {sale.payments.length === 0 && sale.debtAmount === 0 && <p>Sin pago registrado</p>}
        {sale.payments.map((payment) => (
          <div key={payment.id} className="flex justify-between"><span>{PAYMENT_METHOD_LABEL[payment.method]}</span><span>{money.format(payment.amount)}</span></div>
        ))}
        {sale.debtAmount > 0 && (
          <div className="flex justify-between font-bold"><span>Cuenta corriente</span><span>{money.format(sale.debtAmount)}</span></div>
        )}
        {sale.client_name && ticket.customerBalance !== null && (
          <p className="mt-1">Saldo pendiente del cliente: {money.format(Math.max(0, ticket.customerBalance))}</p>
        )}

        <div className="my-3 border-t border-dashed border-black" />
        <p className="text-center text-[11px]">Comprobante de venta — no válido como factura</p>
      </div>

      <style>{`
        @media print {
          @page { margin: 6mm; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  );
}
