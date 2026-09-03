import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { formatBudgetNumber, normalizeBudgetMode } from "@/lib/budgets/calculation";

// Helper to format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(amount);
};

// Create styles
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#333",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 20,
  },
  logoContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  logo: {
    width: 60,
    height: 60,
    marginRight: 10,
    objectFit: "contain",
  },
  companyDetails: {
    flexDirection: "column",
  },
  companyName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#f97316", // orange-500
  },
  headerRight: {
    alignItems: "flex-end",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111",
    marginBottom: 5,
  },
  budgetInfoText: {
    color: "#666",
    marginBottom: 2,
  },
  clientSection: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: "#f9fafb",
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#f97316",
  },
  referenceSection: {
    marginBottom: 18,
    borderLeftWidth: 3,
    borderLeftColor: "#f97316",
    paddingLeft: 10,
  },
  referenceLabel: {
    color: "#777",
    fontSize: 8,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  referenceValue: {
    color: "#222",
    fontSize: 12,
    fontWeight: "bold",
  },
  clientRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  clientLabel: {
    width: 80,
    fontWeight: "bold",
    color: "#555",
  },
  clientValue: {
    flex: 1,
  },
  table: {
    width: "auto",
    marginBottom: 30,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
    backgroundColor: "#f3f4f6",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    fontWeight: "bold",
    color: "#333",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  colProduct: { flex: 4 },
  colQty: { flex: 1, textAlign: "center" },
  colPrice: { flex: 2, textAlign: "right" },
  colSubtotal: { flex: 2, textAlign: "right" },
  
  totalsSection: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 20,
  },
  totalsBox: {
    width: 200,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  totalLabel: {
    color: "#555",
  },
  totalValue: {
    fontWeight: "bold",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#ccc",
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#111",
  },
  grandTotalValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#f97316",
  },
  notesSection: {
    marginTop: 30,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  conditionsSection: {
    marginTop: 22,
    padding: 14,
    backgroundColor: "#f9fafb",
    borderTopWidth: 2,
    borderTopColor: "#f97316",
  },
  conditionRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  conditionLabel: {
    width: 105,
    color: "#666",
    fontWeight: "bold",
  },
  conditionValue: {
    flex: 1,
    color: "#333",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 8,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 10,
  },
});

interface BudgetPDFDocumentProps {
  budget: any;
  items: any[];
  client: any;
  profile: any;
}

export const BudgetPDFDocument: React.FC<BudgetPDFDocumentProps> = ({ budget, items, client, profile }) => {
  const companyName = profile?.company_name || "Stampa3D Academy";
  const sellerName = profile?.display_name || profile?.full_name || "Vendedor";
  const budgetMode = normalizeBudgetMode(budget?.budget_type);
  const isProfessional = budgetMode === "professional";
  
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (dateOnlyMatch) return `${dateOnlyMatch[3]}/${dateOnlyMatch[2]}/${dateOnlyMatch[1]}`;
    const parsed = new Date(dateStr);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString("es-AR");
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            {profile?.company_logo_url ? (
              <Image src={profile.company_logo_url} style={styles.logo} />
            ) : null}
            <View style={styles.companyDetails}>
              <Text style={styles.companyName}>{companyName}</Text>
              {profile?.company_address && <Text style={{ color: "#666" }}>{profile.company_address}</Text>}
              {profile?.company_city && <Text style={{ color: "#666" }}>{profile.company_city}</Text>}
              {profile?.company_phone && <Text style={{ color: "#666" }}>Tel: {profile.company_phone}</Text>}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.title}>PRESUPUESTO</Text>
            <Text style={styles.budgetInfoText}>Nº: {formatBudgetNumber(budget?.budget_number)}</Text>
            <Text style={styles.budgetInfoText}>Fecha: {formatDate(budget?.created_at)}</Text>
            {budget?.valid_until && (
              <Text style={styles.budgetInfoText}>Válido hasta: {formatDate(budget.valid_until)}</Text>
            )}
            {isProfessional && <Text style={styles.budgetInfoText}>Vendedor: {sellerName}</Text>}
          </View>
        </View>

        {budget?.title && (
          <View style={styles.referenceSection}>
            <Text style={styles.referenceLabel}>Referencia</Text>
            <Text style={styles.referenceValue}>{budget.title}</Text>
          </View>
        )}

        {/* Client Section */}
        <View style={styles.clientSection}>
          <Text style={styles.sectionTitle}>DATOS DEL CLIENTE</Text>
          <View style={styles.clientRow}>
            <Text style={styles.clientLabel}>Nombre:</Text>
            <Text style={styles.clientValue}>{client?.name || "Consumidor Final"}</Text>
          </View>
          {isProfessional && client?.cuit && (
            <View style={styles.clientRow}>
              <Text style={styles.clientLabel}>CUIT/DNI:</Text>
              <Text style={styles.clientValue}>{client.cuit}</Text>
            </View>
          )}
          {isProfessional && client?.fiscal_condition && (
            <View style={styles.clientRow}>
              <Text style={styles.clientLabel}>Cond. Fiscal:</Text>
              <Text style={styles.clientValue}>{client.fiscal_condition}</Text>
            </View>
          )}
          {isProfessional && client?.address && (
            <View style={styles.clientRow}>
              <Text style={styles.clientLabel}>Dirección:</Text>
              <Text style={styles.clientValue}>{client.address}</Text>
            </View>
          )}
          {isProfessional && client?.email && (
            <View style={styles.clientRow}>
              <Text style={styles.clientLabel}>Email:</Text>
              <Text style={styles.clientValue}>{client.email}</Text>
            </View>
          )}
          {isProfessional && client?.phone && (
            <View style={styles.clientRow}>
              <Text style={styles.clientLabel}>Teléfono:</Text>
              <Text style={styles.clientValue}>{client.phone}</Text>
            </View>
          )}
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colProduct]}>Producto</Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Cant.</Text>
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>Precio Un.</Text>
            <Text style={[styles.tableHeaderCell, styles.colSubtotal]}>Subtotal</Text>
          </View>
          
          {/* Table Rows */}
          {items && items.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.colProduct}>{item.item_name || "Producto sin nombre"}</Text>
              <Text style={styles.colQty}>{item.quantity}</Text>
              <Text style={styles.colPrice}>{formatCurrency(item.unit_price)}</Text>
              <Text style={styles.colSubtotal}>{formatCurrency(item.subtotal ?? (item.unit_price * item.quantity))}</Text>
            </View>
          ))}
        </View>

        {/* Totals Section */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(budget?.subtotal || 0)}</Text>
            </View>
            
            {budget?.discount_percent > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Descuento ({budget.discount_percent}%)</Text>
                <Text style={styles.totalValue}>- {formatCurrency(budget.discount_amount || 0)}</Text>
              </View>
            )}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Neto</Text>
              <Text style={styles.totalValue}>{formatCurrency(budget?.net_amount ?? ((budget?.subtotal || 0) - (budget?.discount_amount || 0)))}</Text>
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>IVA ({String(budget?.tax_rate || 0).replace(".", ",")}%)</Text>
              <Text style={styles.totalValue}>{formatCurrency(budget?.tax_amount || 0)}</Text>
            </View>
            
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>TOTAL</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(budget?.total_amount || 0)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {budget?.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.sectionTitle}>NOTAS / CONDICIONES</Text>
            <Text style={{ color: "#555", lineHeight: 1.4 }}>{budget.notes}</Text>
          </View>
        )}

        {isProfessional && (budget?.payment_terms || budget?.delivery_time || budget?.delivery_method || budget?.commercial_conditions) && (
          <View style={styles.conditionsSection}>
            <Text style={styles.sectionTitle}>CONDICIONES COMERCIALES</Text>
            {budget?.payment_terms && (
              <View style={styles.conditionRow}>
                <Text style={styles.conditionLabel}>Forma de pago:</Text>
                <Text style={styles.conditionValue}>{budget.payment_terms}</Text>
              </View>
            )}
            {budget?.delivery_time && (
              <View style={styles.conditionRow}>
                <Text style={styles.conditionLabel}>Plazo de entrega:</Text>
                <Text style={styles.conditionValue}>{budget.delivery_time}</Text>
              </View>
            )}
            {budget?.delivery_method && (
              <View style={styles.conditionRow}>
                <Text style={styles.conditionLabel}>Entrega:</Text>
                <Text style={styles.conditionValue}>{budget.delivery_method}</Text>
              </View>
            )}
            {budget?.commercial_conditions && (
              <View style={styles.conditionRow}>
                <Text style={styles.conditionLabel}>Observaciones:</Text>
                <Text style={styles.conditionValue}>{budget.commercial_conditions}</Text>
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          Generado automáticamente desde plataforma Stampa3D - {new Date().toLocaleDateString("es-AR")}
        </Text>
      </Page>
    </Document>
  );
};

export default BudgetPDFDocument;
