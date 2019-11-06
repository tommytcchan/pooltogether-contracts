pragma solidity 0.5.10;

import "./Pool.sol";
import "@openzeppelin/contracts/contracts/math/SafeMath.sol";
import "./UniformRandomNumber.sol";

contract FamilyPool is Pool {
  using SafeMath for uint256;

  FamilyPool public parent;
  mapping(address => uint256) childIndices;
  FamilyPool[] children;

  function init (
    address _owner,
    address _cToken,
    uint256 _feeFraction,
    address _feeBeneficiary,
    string calldata _name,
    string calldata _symbol,
    address[] calldata _defaultOperators,
    FamilyPool _parent
  ) external initializer {
    BasePool.init(_owner, _cToken, _feeFraction, _feeBeneficiary);
    Pool.initERC777(_name, _symbol, _defaultOperators);
    parent = _parent;
  }

  /**
   * @notice Commits the current open draw, if any, and opens the next draw using the passed hash.  Really this function is only called twice:
   * the first after Pool contract creation and the second immediately after.
   * Can only be called by an admin.
   * May fire the Committed event, and always fires the Open event.
   * @param nextSecretHash The secret hash to use to open a new Draw
   */
  function openNextDraw(bytes32 nextSecretHash) public onlyParentOrAdmin unlessPaused {
    BasePool.openNextDraw(nextSecretHash);
    for (uint256 i = 0; i < children.length; i++) {
      FamilyPool child = FamilyPool(children[i]);
      child.openNextDraw(nextSecretHash);
    }
  }

  /**
   * @notice Rewards the current committed draw using the passed secret, commits the current open draw, and opens the next draw using the passed secret hash.
   * Can only be called by an admin.
   * Fires the Rewarded event, the Committed event, and the Open event.
   * @param nextSecretHash The secret hash to use to open a new Draw
   * @param lastSecret The secret to reveal to reward the current committed Draw.
   */
  function rewardAndOpenNextDraw(
    bytes32 nextSecretHash,
    bytes32 lastSecret,
    bytes32 _salt
  ) public onlyAdmin unlessPaused requireCommittedSecret(lastSecret, _salt) {
    bytes32 entropy = keccak256(abi.encodePacked(lastSecret));
    address winningAddress = calculateWinnerWeighted(entropy);
    _reward(nextSecretHash, lastSecret, winningAddress);
  }

  function rewardChild(
    bytes32 lastSecret,
    address winningAddress
  ) public onlyParent {
    _reward(bytes32(0), lastSecret, winningAddress);
  }

  function _reward(
    bytes32 nextSecretHash,
    bytes32 lastSecret,
    address winningAddress
  ) internal {
    _distributeReward(lastSecret, winningAddress);
    // Select the winner using the hash as entropy
    commit();
    open(nextSecretHash);
    for (uint256 i = 0; i < children.length; i++) {
      FamilyPool child = FamilyPool(children[i]);
      child.rewardChild(lastSecret, winningAddress);
    }
  }

  function calculateWinnerWeighted(bytes32 _entropy) public returns (address) {
    // determine total supply.  Each token is weighted equally.
    uint256 totalTokens = weightedCommittedSupply();
    for (uint256 i = 0; i < children.length; i++) {
      FamilyPool child = FamilyPool(children[i]);
      totalTokens = totalTokens.add(child.weightedCommittedSupply());
    }

    // constrain the entropy within the token space
    uint256 token = UniformRandomNumber.uniform(uint256(_entropy), totalTokens);

    // iterate through child pools and select winner
    for (uint256 i = 0; i < children.length; i++) {
      FamilyPool child = FamilyPool(children[i]);
      uint256 weightedSupply = child.weightedCommittedSupply();
      // if the token lands within this child bounds
      if (weightedSupply > token) {
        // return the child's winner
        return child.calculateWinner(_entropy);
      }
      token = token.sub(weightedSupply);
    }
    return calculateWinner(_entropy);
  }

  function weightedCommittedSupply() public returns (uint256) {
    int256 committedSupplyFixed = FixidityLib.newFixed(int256(committedSupply()));
    int256 weightedSupplyFixed = FixidityLib.multiply(interestAsFixedFraction(), committedSupplyFixed);
    return uint256(FixidityLib.fromFixed(weightedSupplyFixed));
  }

  function interestAsFixedFraction() public returns (int256) {
    int256 balanceFixed = FixidityLib.newFixed(int256(balance()));
    int256 accountedBalanceFixed = FixidityLib.newFixed(int256(accountedBalance));
    return FixidityLib.divide(balanceFixed, accountedBalanceFixed);
  }

  function getNextFeeFraction() public view returns (uint256) {
    if (address(parent) != address(0)) {
      return parent.getNextFeeFraction();
    } else {
      return nextFeeFraction;
    }
  }

  function getNextFeeBeneficiary() public view returns (address) {
    if (address(parent) != address(0)) {
      return parent.getNextFeeBeneficiary();
    } else {
      return nextFeeBeneficiary;
    }
  }

  /**
   * @notice Returns the id of the current open Draw.
   * @return The current open Draw id
   */
  function currentOpenDrawId() public view returns (uint256) {
    uint256 drawId;
    if (address(parent) != address(0)) {
      drawId = parent.currentOpenDrawId();
    } else {
      drawId = drawState.openDrawIndex;
    }
    return drawId;
  }

  /**
   * @notice Returns the id of the current committed Draw.
   * @return The current committed Draw id
   */
  function currentCommittedDrawId() public view returns (uint256) {
    uint256 openDrawId = currentOpenDrawId();
    if (openDrawId > 1) {
      return openDrawId - 1;
    } else {
      return 0;
    }
  }

  function isPaused() public view returns (bool) {
    if (address(parent) != address(0)) {
      return parent.isPaused();
    } else {
      return paused;
    }
  }

  function addChild(FamilyPool _child) external onlyAdmin {
    require(address(_child.parent()) == address(this), "parent does not match");
    bool existsAlready = children.length > 0 && address(_child) == address(children[childIndices[address(_child)]]);
    require(!existsAlready, "child already added");
    uint256 index = children.length;
    children.push(_child);
    childIndices[address(_child)] = index;
  }

  modifier onlyParent() {
    require(address(parent) != address(0), "parent must exist");
    require(msg.sender == address(parent), "not the the parent");
    _;
  }

  modifier onlyParentOrAdmin() {
    if (address(parent) != address(0)) {
      require(msg.sender == address(parent), "not the the parent");
    } else {
      require(isAdmin(msg.sender), "not an admin");
    }
    _;
  }
}