# SOLO LECTURA (solo GET). Estado actual de una suscripción en Mercado Pago, sus cuotas y sus pagos.
# No imprime emails, tarjetas ni el token. Incidente P0 2026-11-05 (pago aprobado sin Premium).
# Uso (en TU PowerShell; el token no se imprime ni se guarda en ningún archivo):
#   $s = Read-Host "Access token de PRODUCCION" -AsSecureString   # no se ve al escribir ni queda en el historial
#   $env:MP_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
#   .\20261105_mp_preapproval_readonly.ps1 -Ids "<preapproval_id_1>","<preapproval_id_2>"
#   Remove-Item Env:MP_TOKEN   # al terminar
#
# Qué responde (en este orden):
#   1. La preapproval (estado, monto cobrado según MP).
#   2. Las cuotas con la búsqueda QUE USA EL CÓDIGO CORREGIDO (solo `preapproval_id`). Si da 400, se imprime el
#      motivo que da Mercado Pago (antes solo se veía "HTTP 400").
#   3. La misma búsqueda con `limit` (la forma anterior), para confirmar si el 400 venía de ese parámetro.
#   4. Los pagos con el `external_reference` del checkout (la vía alternativa del código corregido): estado, detalle
#      y si están vinculados a esta suscripción. `approved` = cobro aprobado (lo único que habilita Premium).
param([Parameter(Mandatory)][string[]]$Ids)
if (-not $env:MP_TOKEN) { throw "Definí `$env:MP_TOKEN primero." }
$h = @{ Authorization = "Bearer $($env:MP_TOKEN)" }
$api = "https://api.mercadopago.com"

function Show-HttpError($label, $err) {
  $code = $err.Exception.Response.StatusCode.value__
  $reason = ""
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
    try {
      $b = $err.ErrorDetails.Message | ConvertFrom-Json
      $reason = (@($b.error, $b.message, $b.cause[0].code, $b.cause[0].description) | Where-Object { $_ }) -join " · "
    } catch { $reason = $err.ErrorDetails.Message.Substring(0, [Math]::Min(200, $err.ErrorDetails.Message.Length)) }
  }
  Write-Host "${label}: HTTP $code $reason"
}

function Show-Invoices($r, $id) {
  Write-Host "cuotas encontradas: $(@($r.results).Count) (total informado: $($r.paging.total))"
  @($r.results) | Where-Object { "$($_.preapproval_id)" -eq $id } | ForEach-Object {
    [pscustomobject]@{ invoice_id = $_.id; status = $_.status; payment_id = $_.payment.id; payment_status = $_.payment.status
      payment_status_detail = $_.payment.status_detail; amount = $_.transaction_amount; debit_date = $_.debit_date; retry_attempt = $_.retry_attempt }
  } | Format-Table -AutoSize
}

foreach ($id in $Ids) {
  Write-Host "=== preapproval $($id.Substring(0,[Math]::Min(8,$id.Length)))… ==="
  $ref = $null
  try {
    $p = Invoke-RestMethod -Uri "$api/preapproval/$id" -Headers $h
    $ref = "$($p.external_reference)"
    [pscustomobject]@{
      status = $p.status; date_created = $p.date_created; last_modified = $p.last_modified
      next_payment_date = $p.next_payment_date; charged_quantity = $p.summarized.charged_quantity
      charged_amount = $p.summarized.charged_amount; pending_charge_quantity = $p.summarized.pending_charge_quantity
      last_charged_date = $p.summarized.last_charged_date; amount = $p.auto_recurring.transaction_amount
      currency = $p.auto_recurring.currency_id; has_payer_id = [bool]$p.payer_id
      has_card = [bool]$p.card_id; external_reference_prefix = $ref.Substring(0,[Math]::Min(22,$ref.Length))
    } | Format-List
  } catch { Show-HttpError "preapproval" $_ }

  Write-Host "--- cuotas: /authorized_payments/search?preapproval_id= (forma corregida) ---"
  try { Show-Invoices (Invoke-RestMethod -Uri "$api/authorized_payments/search?preapproval_id=$id" -Headers $h) $id }
  catch { Show-HttpError "cuotas (solo preapproval_id)" $_ }

  Write-Host "--- cuotas: con limit (forma anterior, solo para comparar) ---"
  try { Show-Invoices (Invoke-RestMethod -Uri "$api/authorized_payments/search?preapproval_id=$id&limit=20" -Headers $h) $id }
  catch { Show-HttpError "cuotas (con limit)" $_ }

  if ($ref) {
    Write-Host "--- pagos: /v1/payments/search?external_reference= (vía alternativa) ---"
    try {
      $q = [uri]::EscapeDataString($ref)
      $r = Invoke-RestMethod -Uri "$api/v1/payments/search?external_reference=$q&sort=date_created&criteria=desc" -Headers $h
      Write-Host "pagos encontrados: $(@($r.results).Count)"
      @($r.results) | ForEach-Object {
        $linked = "$($_.point_of_interaction.transaction_data.subscription_id)"
        if (-not $linked) { $linked = "$($_.metadata.preapproval_id)" }
        [pscustomobject]@{ payment_id = $_.id; status = $_.status; status_detail = $_.status_detail; amount = $_.transaction_amount
          date_approved = $_.date_approved; linked_to_this_preapproval = ($linked -eq $id); has_link = [bool]$linked
          invoice_id = $_.point_of_interaction.transaction_data.invoice_id }
      } | Format-Table -AutoSize
    } catch { Show-HttpError "pagos" $_ }
  }
}
