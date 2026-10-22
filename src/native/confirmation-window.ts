/** Constant native view; all project content arrives as JSON data over stdin. */
export const WINDOWS_DIALOG_SCRIPT = `$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
trap { exit 3 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$dialogData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) | ConvertFrom-Json
if ($null -eq $dialogData -or $null -eq $dialogData.message -or $null -eq $dialogData.title -or $null -eq $dialogData.view) { exit 3 }
$view = $dialogData.view
foreach ($field in @('heading','intro','projectRoot','goal','approveLabel','scopeLabel','commandLabel','paths','commands','limits','boundary')) { if ($null -eq $view.$field) { exit 3 } }
if ([string]::IsNullOrWhiteSpace($view.projectRoot) -or [string]::IsNullOrWhiteSpace($view.approveLabel)) { exit 3 }
$ink = [Drawing.ColorTranslator]::FromHtml('#172B2A')
$muted = [Drawing.ColorTranslator]::FromHtml('#536461')
$accent = [Drawing.ColorTranslator]::FromHtml('#176B54')
$canvas = [Drawing.ColorTranslator]::FromHtml('#F3F6F5')
$paper = [Drawing.Color]::White
if ([Windows.Forms.SystemInformation]::HighContrast) { $ink = [Drawing.SystemColors]::WindowText; $muted = $ink; $accent = [Drawing.SystemColors]::Highlight; $canvas = [Drawing.SystemColors]::Control; $paper = [Drawing.SystemColors]::Window }
$bodyFont = New-Object Drawing.Font('Segoe UI',10)
$monoFont = New-Object Drawing.Font('Consolas',10)
$dialogForm = New-Object Windows.Forms.Form
$dialogRealized = @{ written = $false }
$dialogForm.Add_HandleCreated({ if (-not $dialogRealized.written) { $dialogRealized.written = $true; [Console]::Write('realized:') } })
$dialogForm.SuspendLayout()
$dialogForm.Text = $dialogData.title
$dialogForm.Font = $bodyFont; $dialogForm.AutoScaleMode = 'Font'
$dialogForm.BackColor = $canvas; $dialogForm.ForeColor = $ink
$dialogForm.StartPosition = 'CenterScreen'; $dialogForm.ShowIcon = $false
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$dialogForm.Size = New-Object Drawing.Size([Math]::Min(860,$area.Width-40),[Math]::Min(860,$area.Height-40))
$dialogForm.MinimumSize = New-Object Drawing.Size([Math]::Min(660,$area.Width-40),[Math]::Min(560,$area.Height-40))
$frame = New-Object Windows.Forms.TableLayoutPanel
$frame.Dock = 'Fill'; $frame.ColumnCount = 1; $frame.RowCount = 3; $frame.Margin = 0
[void]$frame.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
[void]$frame.RowStyles.Add((New-Object Windows.Forms.RowStyle('Percent',100)))
[void]$frame.RowStyles.Add((New-Object Windows.Forms.RowStyle('Absolute',88)))
$dialogForm.Controls.Add($frame)
function New-FyLabel($text,$size,$bold) {
  $label = New-Object Windows.Forms.Label
  $label.Text = [string]$text; $label.UseMnemonic = $false; $label.AutoSize = $true
  $label.Font = New-Object Drawing.Font('Segoe UI',$size,([Drawing.FontStyle]$(if ($bold) { 'Bold' } else { 'Regular' })))
  $label.MaximumSize = New-Object Drawing.Size(740,0); $label.Margin = New-Object Windows.Forms.Padding(0,0,0,8)
  return $label
}
$header = New-Object Windows.Forms.FlowLayoutPanel
$header.Dock = 'Fill'; $header.AutoSize = $true; $header.FlowDirection = 'TopDown'; $header.WrapContents = $false
$header.Padding = New-Object Windows.Forms.Padding(28,22,28,14); $header.Margin = 0; $header.BackColor = $paper
$brand = New-FyLabel 'FORGEYARD  /  AUTORIZZAZIONE LOCALE' 9 $true; $brand.ForeColor = $accent
$heading = New-FyLabel $view.heading 24 $true
$intro = New-FyLabel $view.intro 10 $false; $intro.ForeColor = $muted
$header.Controls.AddRange(@($brand,$heading,$intro)); $frame.Controls.Add($header,0,0)
$dialogBody = New-Object Windows.Forms.FlowLayoutPanel
$dialogBody.Dock = 'Fill'; $dialogBody.FlowDirection = 'TopDown'; $dialogBody.WrapContents = $false
$dialogBody.AutoScroll = $true; $dialogBody.Padding = New-Object Windows.Forms.Padding(24,16,8,0); $dialogBody.Margin = 0
$frame.Controls.Add($dialogBody,0,1)
function New-FyCard($caption,$value,$name,$mono) {
  $card = New-Object Windows.Forms.FlowLayoutPanel
  $card.FlowDirection = 'TopDown'; $card.WrapContents = $false; $card.AutoSize = $true; $card.AutoSizeMode = 'GrowAndShrink'
  $card.Width = 760; $card.Padding = New-Object Windows.Forms.Padding(18,14,18,12)
  $card.Margin = New-Object Windows.Forms.Padding(0,0,0,12); $card.BackColor = $paper
  $card.AccessibleName = $caption
  $captionLabel = New-FyLabel $caption 9 $true; $captionLabel.ForeColor = $muted
  $valueBox = New-Object Windows.Forms.TextBox
  $valueBox.Name = $name; $valueBox.AccessibleName = $caption
  $valueBox.Text = ([string]$value -replace '\r?\n',[Environment]::NewLine); $valueBox.Multiline = $true; $valueBox.ReadOnly = $true; $valueBox.MaxLength = 0
  $valueBox.BorderStyle = 'None'; $valueBox.BackColor = $paper; $valueBox.ForeColor = $ink
  $valueBox.Font = $(if ($mono) { $monoFont } else { $bodyFont }); $valueBox.ScrollBars = 'None'; $valueBox.Margin = 0
  $valueBox.Width = 720; $valueBox.Height = 44
  $card.Controls.AddRange(@($captionLabel,$valueBox))
  return $card
}
$dialogBody.Controls.Add((New-FyCard 'Progetto' $view.projectRoot 'project-root' $true))
$dialogBody.Controls.Add((New-FyCard 'Lavoro proposto' $view.goal 'requested-change' $false))
$pair = New-Object Windows.Forms.FlowLayoutPanel
$pair.Name = 'paired'; $pair.FlowDirection = 'LeftToRight'; $pair.WrapContents = $false; $pair.Margin = 0
$scopeText = $(if ($view.paths.Count -gt 0) { $view.paths -join [Environment]::NewLine } else { 'Nessuna nuova modifica ai file autorizzata da questa conferma.' })
$scopeCard = New-FyCard $view.scopeLabel $scopeText 'write-scopes' $true
$scopeCard.Margin = New-Object Windows.Forms.Padding(0,0,12,12)
$commandText = $(if ($view.commands.Count -gt 0) { $view.commands -join ([Environment]::NewLine+[Environment]::NewLine) } else { 'Nessun comando configurato.' })
$commandCard = New-FyCard $view.commandLabel $commandText 'verification-commands' $true
$pair.Controls.AddRange(@($scopeCard,$commandCard)); $dialogBody.Controls.Add($pair)
$limitText = $view.limits -join [Environment]::NewLine
if ($null -ne $view.deadlineAt) { $limitText += [Environment]::NewLine + 'Scadenza originale: ' + [DateTimeOffset]::Parse($view.deadlineAt).ToLocalTime().ToString('dd/MM/yyyy HH:mm zzz') }
$dialogBody.Controls.Add((New-FyCard 'Limiti e informazioni da conoscere' $limitText 'operational-limits' $false))
$boundary = New-FyLabel $view.boundary 9 $false; $boundary.ForeColor = $muted; $boundary.Margin = New-Object Windows.Forms.Padding(4,0,4,16)
$dialogBody.Controls.Add($boundary)
$footer = New-Object Windows.Forms.FlowLayoutPanel
$footer.Dock = 'Fill'; $footer.FlowDirection = 'RightToLeft'; $footer.WrapContents = $false
$footer.Padding = New-Object Windows.Forms.Padding(24,20,24,16); $footer.Margin = 0; $footer.BackColor = $paper
function New-FyButton($text,$width) {
  $button = New-Object Windows.Forms.Button
  $button.Text = $text; $button.UseMnemonic = $false; $button.Width = $width; $button.Height = 44
  $button.FlatStyle = 'Flat'; $button.FlatAppearance.BorderSize = 1
  $button.Margin = New-Object Windows.Forms.Padding(10,0,0,0); $button.Font = $bodyFont
  return $button
}
$dialogApprove = New-FyButton $view.approveLabel 208
$dialogApprove.BackColor = $accent; $dialogApprove.ForeColor = [Drawing.SystemColors]::HighlightText
$dialogApprove.FlatAppearance.BorderSize = 0; $dialogApprove.DialogResult = [Windows.Forms.DialogResult]::Yes
$dialogReject = New-FyButton 'Annulla' 104
$dialogReject.BackColor = $paper; $dialogReject.ForeColor = $ink; $dialogReject.FlatAppearance.BorderColor = $muted
$dialogReject.DialogResult = [Windows.Forms.DialogResult]::No
$details = New-FyButton 'Dettagli tecnici' 148
$details.Name = 'technical-details'; $details.FlatAppearance.BorderSize = 0; $details.ForeColor = $accent
$details.Add_Click({
  $detailForm = New-Object Windows.Forms.Form
  $detailForm.Text = 'Forgeyard · Dettagli completi della conferma'; $detailForm.Size = $dialogForm.Size
  $detailForm.StartPosition = 'CenterParent'; $detailForm.Font = $bodyFont
  $detailText = New-Object Windows.Forms.TextBox
  $detailText.Dock = 'Fill'; $detailText.Multiline = $true; $detailText.ReadOnly = $true; $detailText.MaxLength = 0
  $detailText.Font = $monoFont; $detailText.WordWrap = $false; $detailText.ScrollBars = 'Both'
  $detailText.Text = ($dialogData.message -replace '\r?\n',[Environment]::NewLine); $detailText.BackColor = $paper; $detailText.ForeColor = $ink
  $detailForm.Controls.Add($detailText)
  $detailForm.Add_Shown({ $detailText.SelectionStart = 0; $detailText.SelectionLength = 0 })
  [void]$detailForm.ShowDialog($dialogForm); $detailForm.Dispose()
})
$footer.Controls.AddRange(@($dialogApprove,$dialogReject,$details)); $frame.Controls.Add($footer,0,2)
$dialogForm.CancelButton = $dialogReject; $dialogForm.ActiveControl = $dialogReject
$resize = {
  $width = [Math]::Max(300,$dialogBody.ClientSize.Width-56)
  foreach ($label in $header.Controls) { $label.MaximumSize = New-Object Drawing.Size($width,0) }
  foreach ($block in $dialogBody.Controls) {
    if ($block.Name -eq 'paired') { $block.Width = $width; $cards = @($block.Controls); $cardWidth = [int](($width-12)/2) }
    elseif ($block -is [Windows.Forms.Label]) { $block.MaximumSize = New-Object Drawing.Size(($width-8),0); continue }
    else { $cards = @($block); $cardWidth = $width }
    foreach ($card in $cards) {
      $card.AutoSize = $true; $card.Width = $cardWidth
      $card.Controls[0].MaximumSize = New-Object Drawing.Size(($cardWidth-36),0)
      $box = $card.Controls[1]; $box.Width = $cardWidth-36
      $textHeight = (1 + $box.GetLineFromCharIndex([Math]::Max(0,$box.TextLength-1))) * $box.Font.Height + 6
      $box.Height = [Math]::Min(152,[Math]::Max(24,$textHeight))
      $box.ScrollBars = $(if ($textHeight -gt 152) { 'Vertical' } else { 'None' })
    }
    if ($block.Name -eq 'paired') { $pairHeight = [Math]::Max($cards[0].Height,$cards[1].Height); foreach ($card in $cards) { $card.AutoSize = $false; $card.Height = $pairHeight }; $block.Height = $pairHeight+12 }
  }
}
$dialogBody.Add_SizeChanged($resize)
$dialogForm.ResumeLayout($true)
& $resize
$dialogOutcome = $dialogForm.ShowDialog()
if ($dialogOutcome -eq [Windows.Forms.DialogResult]::Yes) { [Console]::Write('approved') } elseif ($dialogOutcome -eq [Windows.Forms.DialogResult]::No -or $dialogOutcome -eq [Windows.Forms.DialogResult]::Cancel) { [Console]::Write('rejected') }
$dialogForm.Dispose()`;
