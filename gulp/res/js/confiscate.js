/* globals __ doModal */
//Confiscate a deposit from the owner's wallet. Used on the Deposits page and on
//signed posts in staff views. Requires MetaMask/ethereum injected provider.
(function () {
	'use strict';

	let depositChainId = null;
	let depositContractAddress = null;
	let canConfiscate = false;
	let owner = null;

	const short = (s) => s ? `${s.substring(0, 6)}…${s.substring(s.length - 4)}` : '';

	async function requestAccounts() {
		if (!window.ethereum || !window.ethereum.request) {
			throw new Error(__('A web3 wallet is required to confiscate deposits.'));
		}
		const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
		if (!accounts || accounts.length === 0) {
			throw new Error(__('Refused account access.'));
		}
		return accounts[0];
	}

	async function readContract() {
		const chainId = parseInt(await window.ethereum.request({ method: 'eth_chainId' }), 16);
		if (depositChainId && chainId !== depositChainId) {
			throw new Error(__('Connected to the wrong network. Switch to the deposit network.'));
		}
		//owner()
		const result = await window.ethereum.request({
			method: 'eth_call',
			params: [{
				to: depositContractAddress,
				data: '0x8da5cb5b',
			}, 'latest'],
		});
		if (!result || result === '0x') {
			throw new Error(__('Could not read the contract owner.'));
		}
		return '0x' + result.slice(-40).toLowerCase();
	}

	async function getAmount() {
		//depositRequirement()
		const result = await window.ethereum.request({
			method: 'eth_call',
			params: [{
				to: depositContractAddress,
				data: '0x8bbcf85f',
			}, 'latest'],
		});
		if (!result || result === '0x') {
			return null;
		}
		//uint256 wei amounts exceed Number precision
		return BigInt(result).toString();
	}

	async function confirmAndSend(address) {
		const account = await requestAccounts();
		owner = await readContract();
		if (account.toLowerCase() !== owner) {
			throw new Error(__('The connected wallet is not the deposit contract owner.'));
		}
		const amount = await getAmount();
		const amountText = amount != null ? ` (${amount})` : '';
		//the reason goes into the public modlog; cancel aborts before any tx is sent
		const reason = window.prompt(__('Confiscate the deposit for key %s%s? This removes their posts and writes a public log.', short(address), amountText)
			+ '\n' + __('Reason (shown in the public modlog):'), '');
		if (reason == null) {
			return null; //cancelled; caller stops without sending anything
		}
		//confiscate(address): selector 0x44f252a0 + 32-byte padded address
		const txHash = await window.ethereum.request({
			method: 'eth_sendTransaction',
			params: [{
				from: account,
				to: depositContractAddress,
				data: `0x44f252a0${'00'.repeat(12)}${address.slice(2).toLowerCase()}`,
			}],
		});
		//wait for the receipt to confirm the confiscation actually happened
		const receipt = await waitForReceipt(txHash);
		if (!receipt || receipt.status !== '0x1') {
			throw new Error(__('Confiscation transaction failed.'));
		}
		return { txHash, reason: reason.trim() };
	}

	function waitForReceipt(txHash) {
		return new Promise((resolve, reject) => {
			const check = async () => {
				try {
					const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
					if (receipt) {
						resolve(receipt);
					} else {
						setTimeout(check, 1500);
					}
				} catch (e) {
					reject(e);
				}
			};
			check();
		});
	}

	async function confiscate(button) {
		const address = button.dataset.address;
		//post buttons have no csrf of their own; staff views carry it on the action form
		const csrfInput = document.querySelector('input[name="_csrf"]');
		const csrf = button.dataset.csrf || (csrfInput && csrfInput.value);
		if (!address || !csrf) {
			return;
		}
		try {
			const sent = await confirmAndSend(address);
			//user cancelled the confirm; do not proceed
			if (sent == null) {
				return;
			}
			const { txHash, reason } = sent;
			const res = await fetch('/forms/global/confiscate', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					'x-using-xhr': 'true',
				},
				body: new URLSearchParams({
					address,
					txHash,
					reason,
					_csrf: csrf,
				}),
			});
			const json = await res.json().catch(() => null);
			doModal(json || { title: __('Confiscate'), message: __('Could not confirm the confiscation with the server. The transaction succeeded; the posts will be removed when the chain listener sees it.') });
			if (json && res.status === 200) {
				//refresh so tombstones and modlog reflect the change
				setTimeout(() => window.location.reload(), 1500);
			}
		} catch (e) {
			console.warn(e);
			doModal({
				title: __('Confiscate'),
				message: e.message || __('Could not confiscate the deposit.'),
			});
		}
	}

	const revealButtons = (root) => {
		if (!canConfiscate) {
			return;
		}
		for (const btn of root.querySelectorAll('.confiscate-button[hidden]')) {
			btn.hidden = false;
		}
	};

	window.addEventListener('settingsReady', () => {
		const meta = document.querySelector('meta[name="deposit-config"]');
		if (meta) {
			try {
				const cfg = JSON.parse(meta.content);
				depositChainId = cfg.chainId;
				depositContractAddress = cfg.contractAddress;
				canConfiscate = cfg.canConfiscate === true;
			} catch (e) {
				//leave unset
			}
		}
		revealButtons(document);
		//delegated so posts added by live updates work too
		document.addEventListener('click', (e) => {
			const btn = e.target.closest && e.target.closest('.confiscate-button');
			if (btn) {
				e.preventDefault();
				confiscate(btn);
			}
		});
	});

	window.addEventListener('addPost', (e) => {
		if (e.detail && e.detail.post) {
			revealButtons(e.detail.post);
		}
	});

})();
