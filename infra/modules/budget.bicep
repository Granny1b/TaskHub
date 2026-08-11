param name string

@description('Monthly budget in the billing account currency.')
param amount int

param contactEmail string

@description('First day of the month the budget starts. Defaults to the current month.')
param startDate string = utcNow('yyyy-MM-01')

/*
  Budget alert.

  The projected cost of this footprint is a fraction of a euro per month, so a
  EUR 5 threshold is not a spending limit — it is a tripwire. If it fires,
  something is wrong: a runaway upload loop, an unexpected egress bill, or
  someone quietly enabling a paid tier. Notice it early rather than at the end
  of the month.

  Note that a budget alert notifies; it does not cap. Azure has no hard spend
  cap outside of specific subscription types.
*/

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: name
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: {
      // 80% is the early warning; 100% means look now.
      warning: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: [contactEmail]
        thresholdType: 'Actual'
      }
      exceeded: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: [contactEmail]
        thresholdType: 'Actual'
      }
      forecast: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: [contactEmail]
        thresholdType: 'Forecasted'
      }
    }
  }
}

output budgetName string = budget.name
