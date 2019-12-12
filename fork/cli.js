#!/usr/bin/env node
const commander = require('commander');
const chalk = require('chalk')
const { showUsers } = require('./showUsers')
const { startFork } = require('./startFork')
const { pay } = require('./pay')
const { upgradePool } = require('./upgradePool')
const { pushContracts } = require('./pushContracts')
const { withdrawAndDeposit } = require('./withdrawAndDeposit')
const { reward } = require('./reward')
const { deployPoolDai } = require('./deployPoolDai')
const { mint } = require('./mint')
const { migrateSai } = require('./migrateSai')
const { poolBalances } = require('./poolBalances')
const { swapSaiToDai } = require('./swapSaiToDai')
const { wards } = require('./wards')
const { trace } = require('./trace')
const { context } = require('./context')
const { traceProvider } = require('./traceProvider')

const program = new commander.Command()
program.description('Handles fork scripting.  Start a mainnet fork then run scripts against it.')
program.option('-v --verbose', 'make all commands verbose', () => true)
program.option('-f --force', 'force the OpenZeppelin push command', () => true)
program.option('-m --mainnet', 'use mainnet')
program.option('-t --trace', 'trace the execution', () => true)

let providerEngine

async function callContext() {
  if (program.trace) {
    console.log(chalk.dim('Loading trace provider engine...'))
    providerEngine = traceProvider({ rpcUrl: process.env.LOCALHOST_URL })
  }
  return await context(program.verbose, program.mainnet, providerEngine)
}

async function run(actionPromise) {
  ranAction = true
  await actionPromise
  if (providerEngine) {
    console.log(chalk.dim('Stopping trace provider engine...'))
    providerEngine.stop()
  }
}

program
  .command('start')
  .description('Starts a local node that is forked from mainnet.  Available on http://localhost:8546')
  .action(async () => {
    await run(startFork())
  })

program
  .command('pay')
  .description('transfers eth to the admin account on the fork')
  .action(async () => {
    await run(pay(await callContext()))
  })

program
  .command('push')
  .description('pushes the latest contracts to the fork')
  .action(async () => {
    await run(pushContracts())
  })

program
  .command('upgrade-v2x')
  .description('Executes the v2x migration')
  .action(async () => {
    await run(upgradePool(await callContext()))
  })

program
  .command('deploy-dai')
  .description('deploys the McDai Pool')
  .action(async () => {
    await run(deployPoolDai(await callContext()))
  })

program
  .command('reward [type] [count]')
  .description('reward and open the next draw [count] times. Type is one of sai | dai.  Defaults to sai')
  .action(async (type, count) => {
    const c = await callContext()
    if (!type) {
      type = 'sai'
    }
    if (!count) {
      count = 1
    }
    await run(async function () {
      for (let i = 0; i < count; i++) {
        await reward(c, type)
      }
    })
  })

program
  .command('withdraw-deposit [type] Type is one of sai | dai.  Defaults to sai')
  .description('tests withdrawals and deposits for top 5 users')
  .action(async (type) => {
    if (!type) {
      type = 'sai'
    }
    await run(withdrawAndDeposit(await callContext(), type))
  })

program
  .command('list')
  .description('list the top 10 users')
  .action(async () => {
    await run(showUsers())
  })

program
  .command('trace [hash]')
  .description('show a transaction trace for the given hash')
  .action(async (hash) => {
    await run(trace(await callContext(), hash))
  })

program
  .command('mint [type]')
  .description('transfers dai to the top 10 users.  Type is one of sai | dai.  Defaults to sai')
  .action(async (type) => {
    if (!type) {
      type = 'sai'
    }
    await run(mint(await callContext(), type))
  })

program
  .command('swap')
  .description('swaps sai to dai for the little sai buddy')
  .action(async () => {
    await run(swapSaiToDai(await callContext()))
  })

program
  .command('wards')
  .description('Show whether the ScdMcdMigration contract is a ward for the SaiJoin')
  .action(async () => {
    await run(wards(await callContext()))
  })

program
  .command('migrate-sai')
  .description('migrates PoolSai for the top 10 users.')
  .action(async () => {
    await run(migrateSai(await callContext()))
  })

program
  .command('balances [type]')
  .description('Displays Pool balances for the top 10 users.   Type is one of sai | dai.  Defaults to sai')
  .action(async (type) => {
    if (!type) {
      type = 'sai'
    }
    await run(poolBalances(await callContext(), type))
  })

program.parse(process.argv)

// if (!ranAction) {
//   console.log(chalk.red(`No command given.`))
//   program.outputHelp()
//   process.exit(1)
// }