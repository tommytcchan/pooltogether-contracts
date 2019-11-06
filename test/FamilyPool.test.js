const toWei = require('./helpers/toWei')
const PoolContext = require('./helpers/PoolContext')
const setupERC1820 = require('./helpers/setupERC1820')
const BN = require('bn.js')
const Pool = artifacts.require('Pool.sol')
const {
  SECRET,
  SALT,
  SECRET_HASH,
  ZERO_ADDRESS,
  TICKET_PRICE
} = require('./helpers/constants')

contract('FamilyPool', (accounts) => {
  
  let parent

  let context1 = new PoolContext({ web3, artifacts, accounts })
  let context2 = new PoolContext({ web3, artifacts, accounts })

  beforeEach(async () => {
    await context1.init({ name: 'Token1', symbol: 'Tok1' })
    await context2.init({ name: 'Token2', symbol: 'Tok2' })

    parent = await context1.createFamilyPool({ name: 'Prize Token 1', symbol: 'pzTok1' })
  })

  describe('init()', () => {
    it('should create the family pool', async () => {
      const child = await context1.createFamilyPool({ name: 'Prize Token 2', symbol: 'pzTok2', parent: parent.address })
      assert.equal(await child.parent(), parent.address)
    })
  })

  describe('with initialized child pool', async () => {
    let child

    beforeEach(async () => {
      child = await context1.createFamilyPool({ name: 'Prize Token 2', symbol: 'pzTok2', parent: parent.address })
    })

    describe('getNextFeeBeneficiary()', () => {
      
    })
  })
})