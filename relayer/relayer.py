import os
import json
import time
import requests
from web3 import Web3
from eth_account import Account
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()

L1_RPC_URL = os.getenv("L1_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")
L2_RPC_URL = os.getenv("L2_RPC_URL", "https://scroll-sepolia-rpc.publicnode.com")
BRIDGE_HISTORY_API = os.getenv("BRIDGE_HISTORY_API", "https://sepolia-api-bridge-v2.scroll.io")
PRIVATE_KEY = os.getenv("RELAYER_PRIVATE_KEY", "0xYour_Relayer_Private_Key")
PROCESSED_FILE = os.path.join(os.path.dirname(__file__), "processed.txt")
PENDING_FILE = os.path.join(os.path.dirname(__file__), "pending.txt")
ADDRESSES_FILE = os.path.join(os.path.dirname(__file__), "..", "addresses.json")

# ABI события WithdrawERC20
WITHDRAW_EVENT_ABI = {
    "anonymous": False,
    "inputs": [
        {"indexed": True, "internalType": "address", "name": "l1Token", "type": "address"},
        {"indexed": True, "internalType": "address", "name": "l2Token", "type": "address"},
        {"indexed": True, "internalType": "address", "name": "from", "type": "address"},
        {"indexed": False, "internalType": "address", "name": "to", "type": "address"},
        {"indexed": False, "internalType": "uint256", "name": "amount", "type": "uint256"},
        {"indexed": False, "internalType": "bytes", "name": "data", "type": "bytes"}
    ],
    "name": "WithdrawERC20",
    "type": "event"
}

# ABI для messenger и bridge (минимальный)
IL1ScrollMessengerABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "_sender", "type": "address"},
            {"internalType": "address", "name": "_target", "type": "address"},
            {"internalType": "uint256", "name": "_value", "type": "uint256"},
            {"internalType": "uint256", "name": "_messageNonce", "type": "uint256"},
            {"internalType": "bytes", "name": "_message", "type": "bytes"},
            {"components": [
                {"internalType": "uint256", "name": "batchIndex", "type": "uint256"},
                {"internalType": "bytes", "name": "merkleProof", "type": "bytes"}
            ], "internalType": "struct IL1ScrollMessenger.L2MessageProof", "name": "_proof", "type": "tuple"}
        ],
        "name": "relayMessageWithProof",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {"inputs": [], "name": "xDomainMessageSender", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"}
]
L1TokenBridgeABI = [
    {"inputs": [], "name": "messenger", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"}
]

# Загрузка адресов
with open(ADDRESSES_FILE) as f:
    addresses = json.load(f)
L1_BRIDGE_ADDRESS = addresses["l1"]["bridge"]
L2_BRIDGE_ADDRESS = addresses["l2"]["bridge"]

# Web3 и аккаунт
w3_l1 = Web3(Web3.HTTPProvider(L1_RPC_URL))
w3_l2 = Web3(Web3.HTTPProvider(L2_RPC_URL))
account = Account.from_key(PRIVATE_KEY)

# Контракты
l1_bridge = w3_l1.eth.contract(address=Web3.to_checksum_address(L1_BRIDGE_ADDRESS), abi=L1TokenBridgeABI)
messenger_address = l1_bridge.functions.messenger().call()
messenger = w3_l1.eth.contract(address=messenger_address, abi=IL1ScrollMessengerABI)
l2_bridge = w3_l2.eth.contract(address=Web3.to_checksum_address(L2_BRIDGE_ADDRESS), abi=[WITHDRAW_EVENT_ABI])

# Загрузка обработанных и ожидающих tx_hash
if os.path.exists(PROCESSED_FILE):
    with open(PROCESSED_FILE) as f:
        processed = set(line.strip() for line in f if line.strip())
else:
    processed = set()
if os.path.exists(PENDING_FILE):
    with open(PENDING_FILE) as f:
        pending = set(line.strip() for line in f if line.strip())
else:
    pending = set()

def save_processed(tx_hash):
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    with open(PROCESSED_FILE, "a") as f:
        f.write(tx_hash + "\n")
    processed.add(tx_hash)

def save_pending(tx_hash):
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    with open(PENDING_FILE, "a") as f:
        f.write(tx_hash + "\n")
    pending.add(tx_hash)

def remove_pending(tx_hash):
    pending.discard(tx_hash)
    # Перезаписываем файл без этого tx_hash
    with open(PENDING_FILE, "w") as f:
        for h in pending:
            f.write(h + "\n")

def get_proof_for_tx(tx_hash):
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    url = f"{BRIDGE_HISTORY_API}/api/txsbyhashes"
    try:
        resp = requests.post(url, json={"txs": [tx_hash]})
        resp.raise_for_status()
        data = resp.json()
        if data.get("errcode", 1) != 0:
            print("Ошибка Bridge History API:", data.get("errmsg"))
            return None
        items = data["data"]["results"]
        if not items:
            return None
        return items[0]
    except Exception as e:
        print(f"Ошибка запроса к Bridge History API для {tx_hash}: {e}")
        return None

def relay_withdrawal(tx_hash):
    if tx_hash in processed:
        return
    proof_data = get_proof_for_tx(tx_hash)
    claim_info = proof_data.get("claim_info") if proof_data else None
    claimable = claim_info.get("claimable") if claim_info else None
    if not (claimable is True or claimable == "true"):
        return False
    claim = claim_info
    from_addr = claim["from"]
    value = int(claim["value"])
    message_nonce = int(claim["nonce"])
    message = bytes.fromhex(claim["message"][2:]) if claim["message"].startswith("0x") else bytes(claim["message"], "utf-8")
    proof = claim["proof"]
    batch_index = int(proof["batch_index"])
    merkle_proof = bytes.fromhex(proof["merkle_proof"][2:]) if proof["merkle_proof"].startswith("0x") else bytes(proof["merkle_proof"], "utf-8")
    print(f"Финализируем tx: {tx_hash} -> {from_addr}, value: {value}, nonce: {message_nonce}")
    try:
        tx = messenger.functions.relayMessageWithProof(
            from_addr,
            L1_BRIDGE_ADDRESS,
            value,
            message_nonce,
            message,
            (batch_index, merkle_proof)
        ).build_transaction({
            "from": account.address,
            "nonce": w3_l1.eth.get_transaction_count(account.address),
            "gas": 2000000,
            "gasPrice": w3_l1.eth.gas_price,
            "value": 0
        })
        signed = account.sign_transaction(tx)
        tx_hash_hex = w3_l1.eth.send_raw_transaction(signed.raw_transaction)
        print(f"Транзакция отправлена: {tx_hash_hex.hex()}")
        save_processed(tx_hash)
        remove_pending(tx_hash)
        return True
    except Exception as e:
        print(f"Ошибка при отправке транзакции: {e}")
        return False

def process_pending():
    # Копируем pending в отдельный список, чтобы не было проблем с изменением множества во время итерации
    for tx_hash in list(pending):
        print(f"Проверка pending tx: {tx_hash}")
        if relay_withdrawal(tx_hash):
            print(f"Финализировано и удалено из pending: {tx_hash}")
        else:
            print(f"Пока не claimable: {tx_hash}")

def main_loop():
    print(f"Relayer started. Address: {account.address}")
    print(f"Listening WithdrawERC20 events on L2 bridge: {L2_BRIDGE_ADDRESS}")
    # Универсальная проверка типа провайдера
    if w3_l2.provider.__class__.__name__ == "WebsocketProvider":
        event_filter = l2_bridge.events.WithdrawERC20.create_filter(from_block='latest')
    else:
        event_filter = l2_bridge.events.WithdrawERC20.create_filter(from_block=w3_l2.eth.block_number)
    while True:
        try:
            # 1. Проверяем все pending
            process_pending()
            # 2. Слушаем новые события WithdrawERC20
            for event in event_filter.get_new_entries():
                l2_tx_hash = event["transactionHash"].hex()
                print(f"Обнаружен WithdrawERC20: {l2_tx_hash}")
                if l2_tx_hash in processed or l2_tx_hash in pending:
                    continue
                # Сразу пробуем финализировать
                if not relay_withdrawal(l2_tx_hash):
                    print(f"Добавляю в pending: {l2_tx_hash}")
                    save_pending(l2_tx_hash)
        except Exception as e:
            print(f"Ошибка в основном цикле: {e}")
            time.sleep(10)
        time.sleep(30)

if __name__ == "__main__":
    main_loop()
