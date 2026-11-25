import { Injectable } from '@angular/core';
import { Sale } from './sales-history-service';

@Injectable({ providedIn: 'root' })
export class ReceiptService {

  /** Imprime el recibo de una venta (abre el diálogo de impresión del navegador). */
  print(sale: Sale): void {
    this.printHtml(this.buildHtml(sale));
  }

  private money(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private esc(text: string): string {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private stamp(d: Date): string {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  private buildHtml(s: Sale): string {
    const taxPct = +(s.taxRate * 100).toFixed(2);
    const method = s.method === 'cash' ? 'Cash' : 'Card';

    const rows = s.items.map(it => `
        <tr>
          <td>${this.esc(it.name)}<small>${it.qty} x ${this.money(it.price)}</small></td>
          <td class="r">${this.money(it.qty * it.price)}</td>
        </tr>`).join('');

    const extra = s.method === 'cash' && s.cashReceived !== null
      ? `<tr><td>Cash received</td><td class="r">${this.money(s.cashReceived)}</td></tr>
         <tr><td>Change</td><td class="r">${this.money(s.change)}</td></tr>`
      : '';

    const stamp = s.status === 'refunded'
      ? `<div class="stamp">REFUNDED${s.refundedAt ? `<small>${this.esc(this.stamp(s.refundedAt))}</small>` : ''}</div>`
      : '';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Receipt ${this.esc(s.id)}</title>
<style>
  @page { margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; width: 72mm; font: 12px/1.45 'Courier New', monospace; color: #000; background: #fff; }
  h1 { margin: 0 0 2px; font-size: 18px; letter-spacing: 2px; text-align: center; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; padding-left: 8px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  small { display: block; font-size: 11px; }
  .total td { padding-top: 4px; font-size: 15px; font-weight: 700; }
  .stamp { margin: 10px 0; padding: 4px; border: 2px solid #000; text-align: center; font-weight: 700; letter-spacing: 3px; }
</style></head>
<body>
  <h1>MARKETPLUS</h1>
  <p class="c">Sales receipt</p>
  <hr>
  <table>
    <tr><td>Receipt</td><td class="r">#${this.esc(s.id)}</td></tr>
    <tr><td>Date</td><td class="r">${this.esc(this.stamp(s.date))}</td></tr>
    <tr><td>Payment</td><td class="r">${method}</td></tr>
  </table>
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    <tr><td>Subtotal</td><td class="r">${this.money(s.subtotal)}</td></tr>
    ${s.discount > 0 ? `<tr><td>Discount</td><td class="r">-${this.money(s.discount)}</td></tr>` : ''}
    <tr><td>Tax (${taxPct}%)</td><td class="r">${this.money(s.tax)}</td></tr>
    <tr class="total"><td>TOTAL</td><td class="r">${this.money(s.total)}</td></tr>
    ${extra}
  </table>
  ${stamp}
  <hr>
  <p class="c">Thank you for your purchase!</p>
</body></html>`;
  }

  /** Imprime HTML en un iframe oculto: no abre pestañas nuevas ni choca con bloqueadores de ventanas. */
  private printHtml(html: string): void {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('title', 'Receipt');
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:640px;border:0;';
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) { frame.remove(); return; }

    doc.open();
    doc.write(html);
    doc.close();

    win.onafterprint = () => setTimeout(() => frame.remove(), 500);
    setTimeout(() => {              // deja que el iframe termine de maquetar antes de imprimir
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 60_000);   // red de seguridad si el navegador no avisa del fin de impresión
    }, 250);
  }
}
