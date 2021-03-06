const toWei = require('./helpers/toWei')
const BN = require('bn.js')
const Token = artifacts.require('Token.sol')
const Pool = artifacts.require('Pool.sol')
const CErc20Mock = artifacts.require('CErc20Mock.sol')
const FixidityLib = artifacts.require('FixidityLib.sol')
const SortitionSumTreeFactory = artifacts.require('SortitionSumTreeFactory.sol')
const DrawManager = artifacts.require('DrawManager.sol')

const debug = require('debug')('Pool.test.js')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Pool', (accounts) => {
  let pool, token, moneyMarket, sumTree, drawManager
  
  const [owner, admin, user1, user2] = accounts

  const ticketPrice = new BN(web3.utils.toWei('10', 'ether'))
  // let feeFraction = new BN('5' + zero_22) // equal to 0.05
  let feeFraction

  const salt = '0x1234123412341234123412341234123412341234123412341234123412341236'
  const secret = '0x1234123412341234123412341234123412341234123412341234123412341234'
  const secretHash = web3.utils.soliditySha3(secret, salt)

  const priceForTenTickets = ticketPrice.mul(new BN(10))

  const supplyRatePerBlock = '100000000000000000' // 0.1 per block

  let Rewarded, Committed

  beforeEach(async () => {
    feeFraction = new BN('0')

    sumTree = await SortitionSumTreeFactory.new()
    await DrawManager.link("SortitionSumTreeFactory", sumTree.address)
    drawManager = await DrawManager.new()
    await Pool.link('DrawManager', drawManager.address)
    fixidity = await FixidityLib.new({ from: admin })

    token = await Token.new({ from: admin })
    await token.initialize(owner)

    moneyMarket = await CErc20Mock.new({ from: admin })
    await moneyMarket.initialize(token.address, new BN(supplyRatePerBlock))

    await token.mint(moneyMarket.address, web3.utils.toWei('10000000', 'ether'))
    await token.mint(user1, web3.utils.toWei('100000', 'ether'))
    await token.mint(user2, web3.utils.toWei('100000', 'ether'))
  })

  async function balance() {
    return (await pool.methods['balance()'].call()).toString()
  }

  async function depositPool(amount, options) {
    if (options) {
      await token.approve(pool.address, amount, options)
      await pool.depositPool(amount, options)  
    } else {
      await token.approve(pool.address, amount)
      await pool.depositPool(amount)
    }
  }

  async function createPool() {
    await Pool.link("DrawManager", drawManager.address)
    await Pool.link("FixidityLib", fixidity.address)

    pool = await Pool.new()
    await pool.init(
      owner,
      moneyMarket.address,
      feeFraction,
      owner
    )

    await openNextDraw()

    return pool
  }

  async function rewardAndOpenNextDraw(options) {
    let logs

    debug(`rewardAndOpenNextDraw(${secretHash}, ${secret})`)
    if (options) {
      logs = (await pool.rewardAndOpenNextDraw(secretHash, secret, salt, options)).logs;
    } else {
      logs = (await pool.rewardAndOpenNextDraw(secretHash, secret, salt)).logs;
    }

    debug('rewardAndOpenNextDraw: ', logs)
    Rewarded = logs[0]
    assert.equal(Rewarded.event, 'Rewarded')
    Committed = logs[1]
    assert.equal(Committed.event, 'Committed')  
  }

  async function openNextDraw() {
    debug(`openNextDraw(${secretHash})`)
    let logs = (await pool.openNextDraw(secretHash)).logs
    Committed = logs[0]
  }

  async function nextDraw(options) {
    let logs
    Rewarded = undefined
    Committed = undefined

    const currentDrawId = await pool.currentCommittedDrawId()

    if (currentDrawId.toString() === '0') {
      await openNextDraw()
    } else {
      debug(`reward(${pool.address})`)
      await moneyMarket.reward(pool.address)
      await rewardAndOpenNextDraw(options)
    }
  }

  async function printDrawIds() {
    const rewardId = await pool.currentRewardedDrawId()
    const commitId = await pool.currentCommittedDrawId()
    const openId = await pool.currentOpenDrawId()
    console.log({ rewardId, commitId, openId })
  }

  describe('addAdmin()', () =>{
    beforeEach(async () => {
      await createPool()
    })

    it('should allow an admin to add another', async () => {
      await pool.addAdmin(user1)
      assert.ok(await pool.isAdmin(user1))
    })

    it('should not allow a non-admin to remove an admin', async () => {
      let fail = true
      try {
        await pool.addAdmin(user2, { from: user1 })
        fail = false
      } catch (e) {}
      assert.ok(fail)
    })
  })

  describe('removeAdmin()', () =>{
    beforeEach(async () => {
      await createPool()
      await pool.addAdmin(user1)
    })

    it('should allow an admin to remove another', async () => {
      await pool.removeAdmin(user1)
      assert.ok(!(await pool.isAdmin(user1)))
    })

    it('should not allow a non-admin to remove an admin', async () => {
      let fail = true
      try {
        await pool.removeAdmin(user1, { from: admin })
        fail = false
      } catch (e) {}
      assert.ok(fail)
    })
  })

  describe('supplyRatePerBlock()', () => {
    it('should work', async () => {
      pool = await createPool() // ten blocks long
      assert.equal(await pool.supplyRatePerBlock(), web3.utils.toWei('0.1', 'ether'))
    })
  })

  describe('committedBalanceOf()', () => {
    it('should return the users balance for the current draw', async () => {
      pool = await createPool()

      await token.approve(pool.address, ticketPrice, { from: user1 })
      await pool.depositPool(ticketPrice, { from: user1 })

      assert.equal((await pool.committedBalanceOf(user1)).toString(), '0')

      await nextDraw()

      assert.equal(await pool.committedBalanceOf(user1), ticketPrice.toString())
    })
  })

  describe('openBalanceOf()', () => {
    it('should return the users balance for the current draw', async () => {
      pool = await createPool()

      await token.approve(pool.address, ticketPrice, { from: user1 })
      await pool.depositPool(ticketPrice, { from: user1 })

      assert.equal((await pool.openBalanceOf(user1)).toString(), ticketPrice.toString())

      await nextDraw()

      assert.equal(await pool.openBalanceOf(user1), '0')
    })
  })

  describe('estimatedInterestRate()', () => {
    it('should set an appropriate limit based on max integers', async () => {
      pool = await createPool() // ten blocks long

      const interestRate = await pool.estimatedInterestRate(10);
      assert.equal(interestRate.toString(), '1000000000000000000')
    })
  })

  describe('getDraw()', () => {
    it('should return empty values if no draw exists', async () => {
      pool = await createPool()
      const draw = await pool.getDraw(12)
      assert.equal(draw.feeFraction, '0')
      assert.equal(draw.feeBeneficiary, ZERO_ADDRESS)
      assert.equal(draw.openedBlock, '0')
      assert.equal(draw.secretHash, '0x0000000000000000000000000000000000000000000000000000000000000000')
    })

    it('should return true values if a draw exists', async () => {
      feeFraction = toWei('0.1')
      pool = await createPool()
      await nextDraw()
      const draw = await pool.getDraw(1)
      assert.equal(draw.feeFraction.toString(), feeFraction.toString())
      assert.equal(draw.feeBeneficiary, owner)
      assert.ok(draw.openedBlock !== '0')
      assert.equal(draw.secretHash, secretHash)
    })
  })

  describe('with a fresh pool', () => {
    beforeEach(async () => {
      pool = await createPool()
    })

    describe('depositPool()', () => {
      it('should fail if not enough tokens approved', async () => {
        await token.approve(pool.address, ticketPrice.div(new BN(2)), { from: user1 })

        let failed
        try {
          await pool.depositPool(ticketPrice, { from: user1 })
          failed = false
        } catch (error) {
          failed = true
        }
        assert.ok(failed, "was able to deposit less than the minimum")
      })

      it('should deposit some tokens into the pool', async () => {
        await token.approve(pool.address, ticketPrice, { from: user1 })

        const response = await pool.depositPool(ticketPrice, { from: user1 })
        const deposited = response.receipt.logs[0]
        assert.equal(deposited.event, 'Deposited')
        assert.equal(deposited.address, pool.address)
        assert.equal(deposited.args[0], user1)
        assert.equal(deposited.args[1].toString(), toWei('10'))
      })

      it('should allow multiple deposits', async () => {
        await token.approve(pool.address, ticketPrice, { from: user1 })

        await pool.depositPool(ticketPrice, { from: user1 })

        await token.approve(pool.address, ticketPrice, { from: user1 })
        await pool.depositPool(ticketPrice, { from: user1 })

        const amount = await pool.balanceOf(user1)
        assert.equal(amount.toString(), ticketPrice.mul(new BN(2)).toString())
      })
    })

    describe('depositSponsorship()', () => {
      beforeEach(async () => {
        await token.approve(pool.address, ticketPrice, { from: user1 })
        await pool.depositPool(ticketPrice, { from: user1 })
      })

      it('should contribute to the winnings', async () => {
        await nextDraw()

        // console.log('checkpoint 1')
        await token.approve(pool.address, toWei('1000'), { from: user2 })
        // console.log('checkpoint 2')
        await pool.depositSponsorship(toWei('1000'), { from: user2 })
        
        // Sponsor has no pool balance
        assert.equal((await pool.openBalanceOf(user2)).toString(), toWei('0'))
        assert.equal((await pool.committedBalanceOf(user2)).toString(), toWei('0'))

        // Sponsor has balance
        assert.equal((await pool.balanceOf(user2)).toString(), toWei('1000'))

        // Sponsor has a sponsorship balance
        assert.equal((await pool.balanceOf(user2)).toString(), toWei('1000'))

        await nextDraw()

        assert.equal(Rewarded.event, 'Rewarded')
        assert.equal(Rewarded.args.winner, user1)

        // User's winnings include interest from the sponsorship
        assert.equal(Rewarded.args.winnings.toString(), toWei('202'))

        // User's balance includes their winnings and the ticket price
        assert.equal((await pool.balanceOf(user1)).toString(), toWei('212'))
      })
    })

    

    describe('withdraw()', () => {
      describe('with sponsorship', () => {
        beforeEach(async () => {
          await token.approve(pool.address, toWei('1000'), { from: user2 })
          await pool.depositSponsorship(toWei('1000'), { from: user2 })
        })
  
        it('should allow the sponsor to withdraw partially', async () => {
          const user2BalanceBefore = await token.balanceOf(user2)
  
          await pool.withdraw({ from: user2 })
  
          assert.equal((await pool.balanceOf(user2)).toString(), toWei('0'))
          const user2BalanceAfter = await token.balanceOf(user2)
          assert.equal(user2BalanceAfter.toString(), user2BalanceBefore.add(new BN(toWei('1000'))).toString())
        })
      })

      it('should work for one participant', async () => {
        await token.approve(pool.address, ticketPrice, { from: user1 })
        await pool.depositPool(ticketPrice, { from: user1 })
        await nextDraw()
        await nextDraw()

        let balance = await pool.balanceOf(user1)
        assert.equal(balance.toString(), toWei('12'))

        const balanceBefore = await token.balanceOf(user1)
        await pool.withdraw({ from: user1 })
        const balanceAfter = await token.balanceOf(user1)

        assert.equal(balanceAfter.toString(), (new BN(balanceBefore).add(balance)).toString())
      })

      it('should work for two participants', async () => {

        await token.approve(pool.address, priceForTenTickets, { from: user1 })
        await pool.depositPool(priceForTenTickets, { from: user1 })

        await token.approve(pool.address, priceForTenTickets, { from: user2 })
        await pool.depositPool(priceForTenTickets, { from: user2 })

        assert.equal((await pool.openSupply()).toString(), toWei('200'))

        await nextDraw()

        assert.equal((await pool.openSupply()).toString(), toWei('0'))
        assert.equal((await pool.committedSupply()).toString(), toWei('200'))

        await nextDraw()
        
        const user1BalanceBefore = await token.balanceOf(user1)
        await pool.withdraw({ from: user1 })
        const user1BalanceAfter = await token.balanceOf(user1)

        const user2BalanceBefore = await token.balanceOf(user2)        
        await pool.withdraw({ from: user2 })
        const user2BalanceAfter = await token.balanceOf(user2)

        const earnedInterest = priceForTenTickets.mul(new BN(2)).mul(new BN(20)).div(new BN(100))

        if (Rewarded.args.winner === user1) {
          assert.equal(user2BalanceAfter.toString(), (new BN(user2BalanceBefore).add(priceForTenTickets)).toString())
          assert.equal(user1BalanceAfter.toString(), (new BN(user1BalanceBefore).add(priceForTenTickets.add(earnedInterest))).toString())
        } else if (Rewarded.args.winner === user2) {
          assert.equal(user2BalanceAfter.toString(), (new BN(user2BalanceBefore).add(priceForTenTickets.add(earnedInterest))).toString())
          assert.equal(user1BalanceAfter.toString(), (new BN(user1BalanceBefore).add(priceForTenTickets)).toString())
        } else {
          throw new Error(`Unknown winner: ${info.winner}`)
        }
      })

      it('should work when one user withdraws before the next draw', async () => {
        await token.approve(pool.address, priceForTenTickets, { from: user1 })
        await pool.depositPool(priceForTenTickets, { from: user1 })

        await token.approve(pool.address, priceForTenTickets, { from: user2 })
        await pool.depositPool(priceForTenTickets, { from: user2 })

        await nextDraw()

        // pool is now committed and earning interest
        await pool.withdraw({ from: user2 })

        await nextDraw()

        // pool has been rewarded
        // earned interest will only be 20% of user1's ticket balance
        const earnedInterest = priceForTenTickets.mul(new BN(20)).div(new BN(100))

        assert.equal(Rewarded.args.winner, user1)
        assert.equal((await pool.balanceOf(user1)).toString(), earnedInterest.add(priceForTenTickets).toString())
      })
    })

    describe('balanceOf()', () => {
      it('should return the entrants total to withdraw', async () => {
        await token.approve(pool.address, ticketPrice, { from: user1 })
        await pool.depositPool(ticketPrice, { from: user1 })

        let balance = await pool.balanceOf(user1)

        assert.equal(balance.toString(), ticketPrice.toString())
      })
    })
  })

  describe('when fee fraction is greater than zero', () => {
    beforeEach(() => {
      /// Fee fraction is 10%
      feeFraction = web3.utils.toWei('0.1', 'ether')
    })

    it('should reward the owner the fee', async () => {

      await createPool()

      const user1Tickets = ticketPrice.mul(new BN(100))
      await token.approve(pool.address, user1Tickets, { from: user1 })
      await pool.depositPool(user1Tickets, { from: user1 })

      await nextDraw()

      /// CErc20Mock awards 20% regardless of duration.
      const totalDeposit = user1Tickets
      const interestEarned = totalDeposit.mul(new BN(20)).div(new BN(100))
      const fee = interestEarned.mul(new BN(10)).div(new BN(100))

      // we expect unlocking to transfer the fee to the owner
      await nextDraw()

      assert.equal(Rewarded.args.fee.toString(), fee.toString())

      assert.equal((await pool.balanceOf(owner)).toString(), fee.toString())

      // we expect the pool winner to receive the interest less the fee
      const user1Balance = await token.balanceOf(user1)
      await pool.withdraw({ from: user1 })
      const newUser1Balance = await token.balanceOf(user1)
      assert.equal(newUser1Balance.toString(), user1Balance.add(user1Tickets).add(interestEarned).sub(fee).toString())
    })
  })

  describe('when a pool is rewarded without a winner', () => {
    it('should save the winnings for the next draw', async () => {

      // Here we create the pool and open the first draw
      await createPool()

      // Now we commit a draw, and open a new draw
      await openNextDraw()

      // We deposit into the pool
      const depositAmount = web3.utils.toWei('100', 'ether')
      await token.approve(pool.address, depositAmount, { from: user1 })
      await pool.depositPool(depositAmount, { from: user1 })

      // The money market should have received this
      assert.equal(await balance(), toWei('100'))

      // The pool is awarded interest, now should have deposit + 20%
      await moneyMarket.reward(pool.address)

      // The new balance should include 20%
      assert.equal(await balance(), toWei('120'))

      // Now we reward the first committed draw.  There should be no winner, and the winnings should carry over
      await rewardAndOpenNextDraw()

      // The user's balance should remain the same
      assert.equal((await pool.balanceOf(user1)).toString(), depositAmount.toString())

      // Now even though there was no reward, the winnings should have carried over
      await rewardAndOpenNextDraw()

      // The user's balance should include the winnings
      assert.equal((await pool.balanceOf(user1)).toString(), web3.utils.toWei('120'))

    })
  })

  describe('setNextFeeFraction()', () => {
    beforeEach(async () => {
      await createPool()
    })

    it('should allow the owner to set the next fee fraction', async () => {
      await pool.setNextFeeFraction(toWei('0.05'))
      assert.equal((await pool.nextFeeFraction()).toString(), toWei('0.05'))
    })

    it('should not allow anyone else to set the fee fraction', async () => {
      let failed = true
      try {
        await pool.setNextFeeFraction(toWei('0.05'), { from: user1 })
        failed = false
      } catch (e) {}
      assert.ok(failed)
    })
  })

  describe('setNextFeeBeneficiary()', () => {
    beforeEach(async () => {
      await createPool()
    })

    it('should allow the owner to set the next fee fraction', async () => {
      await pool.setNextFeeBeneficiary(user1)
      assert.equal((await pool.nextFeeBeneficiary()).toString(), user1)
    })

    it('should not allow anyone else to set the fee fraction', async () => {
      let failed = true
      try {
        await pool.setNextFeeBeneficiary(user1, { from: user1 })
        failed = false
      } catch (e) {}
      assert.ok(failed)
    })
  })

  describe('pause()', () => {
    beforeEach(async () => {
      await createPool()
      await nextDraw()
    })

    it('should not allow any more deposits', async () => {
      await pool.pause()
      let failed = true
      try {
        await depositPool(toWei('10'), { from: user2 })
        failed = false
      } catch (e) {}
      assert.ok(failed)
    })

    it('should not allow new draws', async () => {
      await pool.pause()
      let failed = true
      try {
        await nextDraw()
        failed = false
      } catch (e) {}
      assert.ok(failed)
    })
  })

  describe('unpause()', () => {
    beforeEach(async () => {
      await createPool()
      await pool.pause()
    })

    it('should allow deposit after unpausing', async () => {
      await pool.unpause()
      await depositPool(toWei('10'), { from: user2 })
    })
  })
})
