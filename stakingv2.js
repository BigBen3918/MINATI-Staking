// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract Ownable {
    address private _owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        _setOwner(msg.sender);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    modifier onlyOwner() {
        require(owner() == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _setOwner(newOwner);
    }

    function _setOwner(address newOwner) private {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

contract MinatiStaking is Ownable {
    IERC20 public minatiToken;
    IERC20 public mbToken;

    uint256 public tokenPrice = 74; // 1 Minati = 74 MB Tokens
    uint256 public constant extraRewardPercent = 30; // 30% extra reward
    uint256 public constant referralRewardPercent = 10; // 10% for referral
    uint256 public lockPeriod = 4 * 30 days; // 4 months lock period
    bool public stakingDisabled;

    struct StakeInfo {
        uint256 stakedMB;
        uint256 lockEndTime;
        bool claimed;
        uint256 extraReward;
    }

    mapping(address => StakeInfo[]) public stakes;
    mapping(address => address) public referrals;
    mapping(address => uint256) public referralCount;
    address[] public stakers;

    event Staked(address indexed user, uint256 minatiAmount, uint256 lockedMB, uint256 instantExtraReward, address indexed referrer);
    event Claimed(address indexed user, uint256 lockedMB);
    event LockRevoked(address indexed user);
    event LockRevokedForAll();
    event Withdrawn(address indexed token, uint256 amount);

    constructor(IERC20 _minatiToken, IERC20 _mbToken) {
        minatiToken = _minatiToken;
        mbToken = _mbToken;
    }

    function stake(uint256 _amount, address _referrer) external {
        require(_amount > 0, "Amount must be greater than 0");
        require(!stakingDisabled, "Staking is currently disabled");

        require(minatiToken.transferFrom(msg.sender, address(this), _amount), "Minati token transfer failed");

        uint256 lockedMB = _amount * tokenPrice;
        uint256 extraReward = (lockedMB * extraRewardPercent) / 100;

        if (_referrer != address(0) && _referrer != msg.sender) {
            if (referrals[msg.sender] == address(0)) {
                referrals[msg.sender] = _referrer;
                referralCount[_referrer]++;
            }
            uint256 referralReward = (lockedMB * referralRewardPercent) / 100;
            require(mbToken.transfer(_referrer, referralReward), "Referral reward transfer failed");
        }

        if (stakes[msg.sender].length == 0) {
            stakers.push(msg.sender); // Add user to stakers list if not already present
        }

        stakes[msg.sender].push(StakeInfo({
            stakedMB: lockedMB,
            lockEndTime: block.timestamp + lockPeriod,
            claimed: false,
            extraReward: extraReward
        }));

        require(mbToken.transfer(msg.sender, extraReward), "Instant reward transfer failed");

        emit Staked(msg.sender, _amount, lockedMB, extraReward, _referrer);
    }

    function claim(uint256 _stakeIndex) external {
        require(_stakeIndex < stakes[msg.sender].length, "Invalid stake index");

        StakeInfo storage stakeInfo = stakes[msg.sender][_stakeIndex];
        require(stakeInfo.stakedMB > 0, "No staking found for this entry");
        require(block.timestamp >= stakeInfo.lockEndTime, "Tokens are still locked");
        require(!stakeInfo.claimed, "Already claimed");

        require(mbToken.transfer(msg.sender, stakeInfo.stakedMB), "MB token claim failed");

        stakeInfo.claimed = true;

        emit Claimed(msg.sender, stakeInfo.stakedMB);
    }

    function revokeLock(address _user) external onlyOwner {
        StakeInfo[] storage userStakes = stakes[_user];
        require(userStakes.length > 0, "No staking found");

        for (uint256 i = 0; i < userStakes.length; i++) {
            if (!userStakes[i].claimed) {
                userStakes[i].lockEndTime = block.timestamp;
            }
        }
        emit LockRevoked(_user);
    }

    function revokeLockForAll() external onlyOwner {
        for (uint256 i = 0; i < stakers.length; i++) {
            address user = stakers[i];
            StakeInfo[] storage userStakes = stakes[user];
            for (uint256 j = 0; j < userStakes.length; j++) {
                if (!userStakes[j].claimed) {
                    userStakes[j].lockEndTime = block.timestamp;
                }
            }
        }
        stakingDisabled = true;
        emit LockRevokedForAll();
    }

    function getUserRewardsAndReferrals(address _user) external view returns (uint256 totalExtraRewards, uint256 totalReferrals) {
        totalReferrals = referralCount[_user];
        StakeInfo[] memory userStakes = stakes[_user];
        for (uint256 i = 0; i < userStakes.length; i++) {
            if (!userStakes[i].claimed) {
                totalExtraRewards += userStakes[i].extraReward;
            }
        }
    }

    function getTotalStaked(address _user) external view returns (uint256 totalStaked) {
        StakeInfo[] memory userStakes = stakes[_user];
        for (uint256 i = 0; i < userStakes.length; i++) {
            if (!userStakes[i].claimed) {
                totalStaked += userStakes[i].stakedMB;
            }
        }
    }

    function getUserStakes(address _user) external view returns (StakeInfo[] memory) {
        return stakes[_user];
    }

    function withdrawTokens(address _token, uint256 _amount) external onlyOwner {
        IERC20 token = IERC20(_token);
        require(token.balanceOf(address(this)) >= _amount, "Insufficient token balance");
        require(token.transfer(msg.sender, _amount), "Token transfer failed");
        emit Withdrawn(_token, _amount);
    }

    function setTokenPrice(uint256 _newPrice) external onlyOwner {
        require(_newPrice > 0, "Price must be greater than 0");
        tokenPrice = _newPrice;
    }
}
