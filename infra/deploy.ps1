<#
.SYNOPSIS
    Deploys the TaskHub infrastructure. Idempotent.

.DESCRIPTION
    Wraps `az deployment sub create`. Running it repeatedly converges the
    footprint rather than duplicating it, so it is safe to re-run after editing
    the Bicep or the parameters.

    Native PowerShell, no WSL, no bash — per the project's OS constraint.

.PARAMETER SubscriptionId
    Target subscription. Defaults to the current az context.

.PARAMETER ParameterFile
    Defaults to main.bicepparam beside this script.

.PARAMETER WhatIf
    Show what would change without changing it. Do this first.

.EXAMPLE
    ./deploy.ps1 -WhatIf
    ./deploy.ps1
#>

[CmdletBinding()]
param(
    [string] $SubscriptionId,
    [string] $ParameterFile = (Join-Path $PSScriptRoot 'main.bicepparam'),
    [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'

function Assert-Command {
    param([string] $Name, [string] $InstallHint)
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not installed or not on PATH. $InstallHint"
    }
}

Assert-Command -Name 'az' -InstallHint 'Install the Azure CLI: https://aka.ms/installazurecli'

$templateFile = Join-Path $PSScriptRoot 'main.bicep'
if (-not (Test-Path $templateFile)) { throw "Template not found: $templateFile" }
if (-not (Test-Path $ParameterFile)) { throw "Parameter file not found: $ParameterFile" }

Write-Host 'Checking Azure login...' -ForegroundColor Cyan
$account = az account show 2>$null | ConvertFrom-Json
if ($null -eq $account) {
    throw 'Not logged in. Run: az login'
}

if ($SubscriptionId) {
    Write-Host "Setting subscription to $SubscriptionId" -ForegroundColor Cyan
    az account set --subscription $SubscriptionId
    $account = az account show | ConvertFrom-Json
}

Write-Host "Subscription: $($account.name) ($($account.id))" -ForegroundColor Green

# Refuse to deploy with the placeholder still in place: a budget alert sent
# nowhere is worse than none, because it looks like cover that is not there.
$parameterText = Get-Content $ParameterFile -Raw
if ($parameterText -match 'REPLACE_ME') {
    throw "Set budgetAlertEmail in $ParameterFile before deploying."
}

# The deployment is subscription-scoped because it creates the resource group.
# This location only decides where deployment metadata is stored.
$deploymentLocation = 'swedencentral'
$deploymentName = "taskhub-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

$arguments = @(
    'deployment', 'sub', 'create',
    '--name', $deploymentName,
    '--location', $deploymentLocation,
    '--template-file', $templateFile,
    '--parameters', $ParameterFile
)

if ($WhatIf) {
    Write-Host 'Running what-if (no changes will be made)...' -ForegroundColor Yellow
    $arguments += '--what-if'
    az @arguments
    return
}

Write-Host "Deploying as $deploymentName..." -ForegroundColor Cyan
az @arguments --output none
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed.' }

$outputs = az deployment sub show --name $deploymentName --query properties.outputs | ConvertFrom-Json

Write-Host ''
Write-Host 'Deployment complete.' -ForegroundColor Green
Write-Host "  Resource group : $($outputs.resourceGroupName.value)"
Write-Host "  Storage account: $($outputs.storageAccountName.value)"
Write-Host "  Static Web App : $($outputs.staticWebAppName.value)"
Write-Host "  URL            : $($outputs.appUrl.value)"
Write-Host ''
Write-Host 'Next: add the deployment token to GitHub as AZURE_STATIC_WEB_APPS_API_TOKEN' -ForegroundColor Yellow
Write-Host '  az staticwebapp secrets list --name' $outputs.staticWebAppName.value '--query "properties.apiKey" -o tsv'
Write-Host ''
Write-Host 'The app denies every user until the allowlist is set. Verify with:' -ForegroundColor Yellow
Write-Host '  az staticwebapp appsettings list --name' $outputs.staticWebAppName.value
