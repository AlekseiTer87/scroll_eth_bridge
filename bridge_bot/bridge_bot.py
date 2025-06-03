import os
import json
import logging
from decimal import Decimal
from typing import Dict, Optional

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, KeyboardButton
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters,
    ConversationHandler
)

from web3 import Web3
from eth_account import Account

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Константы
L1_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com"
L2_RPC_URL = "https://sepolia-rpc.scroll.io"
TELEGRAM_BOT_TOKEN = "7361485994:AAG0aA4_QkIxPHUJ4BrFNw7uxHKmx5b11Cs"  # Токен бота

# Загрузка ABI из файлов
with open("abi/L1CustomToken.json") as f:
    L1_TOKEN_ABI = json.load(f)["abi"]
with open("abi/L1TokenBridge.json") as f:
    L1_BRIDGE_ABI = json.load(f)["abi"]
with open("abi/L2CustomToken.json") as f:
    L2_TOKEN_ABI = json.load(f)["abi"]
with open("abi/L2TokenBridge.json") as f:
    L2_BRIDGE_ABI = json.load(f)["abi"]

# Состояния для обработчика диалога
CHOOSING_DIRECTION, ENTERING_AMOUNT, CONFIRMING_TRANSFER = range(3)

# Загрузка адресов
with open('../addresses.json', 'r') as f:
    ADDRESSES = json.load(f)

class BridgeBot:
    def __init__(self, token: str):
        self.token = token
        self.user_keys: Dict[int, str] = {}  # user_id -> private_key
        self.w3_l1 = Web3(Web3.HTTPProvider(L1_RPC_URL))
        self.w3_l2 = Web3(Web3.HTTPProvider(L2_RPC_URL))
        
        # Инициализация контрактов
        self.l1_token = self.w3_l1.eth.contract(
            address=Web3.to_checksum_address(ADDRESSES['l1']['token']),
            abi=L1_TOKEN_ABI
        )
        self.l1_bridge = self.w3_l1.eth.contract(
            address=Web3.to_checksum_address(ADDRESSES['l1']['bridge']),
            abi=L1_BRIDGE_ABI
        )
        self.l2_token = self.w3_l2.eth.contract(
            address=Web3.to_checksum_address(ADDRESSES['l2']['token']),
            abi=L2_TOKEN_ABI
        )
        self.l2_bridge = self.w3_l2.eth.contract(
            address=Web3.to_checksum_address(ADDRESSES['l2']['bridge']),
            abi=L2_BRIDGE_ABI
        )

    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Отправка приветственного сообщения и показ главного меню."""
        keyboard = [
            [KeyboardButton("Проверить баланс L1"), KeyboardButton("Проверить баланс L2")],
            [KeyboardButton("Перевести токены")],
            [KeyboardButton("Управление приватным ключом")]
        ]
        reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)
        await update.message.reply_text(
            "Добро пожаловать в Bridge Bot! Выберите действие:",
            reply_markup=reply_markup
        )

    async def check_balance(self, update: Update, context: ContextTypes.DEFAULT_TYPE, network: str):
        """Проверка баланса токенов и ETH в указанной сети."""
        query = update.callback_query
        await query.answer()
        
        user_id = query.from_user.id
        if user_id not in self.user_keys:
            await query.edit_message_text(
                "Пожалуйста, сначала установите приватный ключ через опцию 'Управление приватным ключом'."
            )
            return

        try:
            w3 = self.w3_l1 if network == 'l1' else self.w3_l2
            account = Account.from_key(self.user_keys[user_id])
            address = account.address

            # Получение баланса ETH
            eth_balance = w3.eth.get_balance(address)
            eth_balance_eth = Web3.from_wei(eth_balance, 'ether')

            # Получение баланса токенов
            token_contract = self.l1_token if network == 'l1' else self.l2_token
            token_balance = token_contract.functions.balanceOf(address).call()
            token_balance_eth = Web3.from_wei(token_balance, 'ether')

            await query.edit_message_text(
                f"Баланс в сети {network.upper()}:\n"
                f"ETH: {eth_balance_eth:.4f}\n"
                f"Токены: {token_balance_eth:.4f}"
            )
        except Exception as e:
            await query.edit_message_text(f"Ошибка при проверке баланса: {str(e)}")

    async def reply_menu_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        text = update.message.text
        if text == "Проверить баланс L1":
            await self.check_balance_reply(update, context, 'l1')
        elif text == "Проверить баланс L2":
            await self.check_balance_reply(update, context, 'l2')
        elif text == "Перевести токены":
            await self.start_transfer_inline(update, context)
        elif text == "Управление приватным ключом":
            await self.manage_key_reply(update, context)
        elif text == "Назад":
            await self.start(update, context)

    async def check_balance_reply(self, update: Update, context: ContextTypes.DEFAULT_TYPE, network: str):
        user_id = update.effective_user.id
        if user_id not in self.user_keys:
            await update.message.reply_text(
                "Пожалуйста, сначала установите приватный ключ через опцию 'Управление приватным ключом'."
            )
            return
        try:
            w3 = self.w3_l1 if network == 'l1' else self.w3_l2
            account = Account.from_key(self.user_keys[user_id])
            address = account.address
            eth_balance = w3.eth.get_balance(address)
            eth_balance_eth = Web3.from_wei(eth_balance, 'ether')
            token_contract = self.l1_token if network == 'l1' else self.l2_token
            token_balance = token_contract.functions.balanceOf(address).call()
            token_balance_eth = Web3.from_wei(token_balance, 'ether')
            await update.message.reply_text(
                f"Баланс в сети {network.upper()}:\nETH: {eth_balance_eth:.4f}\nТокены: {token_balance_eth:.4f}"
            )
        except Exception as e:
            await update.message.reply_text(f"Ошибка при проверке баланса: {str(e)}")

    async def manage_key_reply(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        user_id = update.effective_user.id
        keyboard = [
            [KeyboardButton("Добавить/Обновить ключ")],
            [KeyboardButton("Удалить ключ")],
            [KeyboardButton("Назад")]
        ]
        reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True, one_time_keyboard=True)
        if user_id in self.user_keys:
            await update.message.reply_text(
                "У вас установлен приватный ключ. Выберите действие:",
                reply_markup=reply_markup
            )
        else:
            await update.message.reply_text(
                "У вас не установлен приватный ключ. Пожалуйста, добавьте его:",
                reply_markup=reply_markup
            )

    async def start_transfer_inline(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        user_id = update.effective_user.id
        if user_id not in self.user_keys:
            await update.message.reply_text(
                "Пожалуйста, сначала установите приватный ключ через опцию 'Управление приватным ключом'."
            )
            return
        keyboard = [
            [
                InlineKeyboardButton("L1 → L2", callback_data='l1_to_l2'),
                InlineKeyboardButton("L2 → L1", callback_data='l2_to_l1')
            ]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        await update.message.reply_text(
            "Выберите направление перевода:",
            reply_markup=reply_markup
        )
        return CHOOSING_DIRECTION

    async def enter_amount(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        query = update.callback_query
        await query.answer()
        context.user_data['direction'] = query.data
        await query.edit_message_text(
            "Пожалуйста, введите количество токенов для перевода:"
        )
        return ENTERING_AMOUNT

    async def confirm_transfer(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        try:
            amount = float(update.message.text)
            if amount <= 0:
                raise ValueError("Сумма должна быть положительной")
            context.user_data['amount'] = amount
            direction = context.user_data['direction']
            gas_limit = 1000000
            gas_price = 0.00000001
            bridge_fee = 0.01
            total_fee = (gas_limit * gas_price) + bridge_fee
            keyboard = [
                [
                    InlineKeyboardButton("Подтвердить", callback_data='confirm_transfer'),
                    InlineKeyboardButton("Отмена", callback_data='cancel_transfer')
                ]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            await update.message.reply_text(
                f"Детали перевода:\n"
                f"Направление: {direction}\n"
                f"Сумма: {amount} токенов\n"
                f"Примерная комиссия: {total_fee:.4f} ETH\n\n"
                f"Пожалуйста, подтвердите перевод:",
                reply_markup=reply_markup
            )
            return CONFIRMING_TRANSFER
        except ValueError as e:
            await update.message.reply_text(
                "Пожалуйста, введите корректное положительное число."
            )
            return ENTERING_AMOUNT

    async def execute_transfer(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Выполнение подтвержденного перевода."""
        query = update.callback_query
        await query.answer()
        
        if query.data == 'cancel_transfer':
            await query.edit_message_text("Перевод отменен.")
            return ConversationHandler.END
        
        try:
            user_id = query.from_user.id
            direction = context.user_data['direction']
            amount = context.user_data['amount']
            
            # Конвертация суммы в wei
            amount_wei = Web3.to_wei(amount, 'ether')
            
            # Получение аккаунта пользователя
            account = Account.from_key(self.user_keys[user_id])
            
            if direction == 'l1_to_l2':
                # Получаем текущую цену газа и увеличиваем её на 20%
                gas_price = int(self.w3_l1.eth.gas_price * 1.2)
                
                # Проверка и одобрение токенов
                allowance = self.l1_token.functions.allowance(
                    account.address,
                    ADDRESSES['l1']['bridge']
                ).call()
                
                if allowance < amount_wei:
                    # Одобрение токенов
                    approve_tx = self.l1_token.functions.approve(
                        ADDRESSES['l1']['bridge'],
                        amount_wei
                    ).build_transaction({
                        'from': account.address,
                        'gas': 100000,
                        'gasPrice': gas_price,
                        'nonce': self.w3_l1.eth.get_transaction_count(account.address)
                    })
                    
                    signed_approve = self.w3_l1.eth.account.sign_transaction(
                        approve_tx,
                        self.user_keys[user_id]
                    )
                    self.w3_l1.eth.send_raw_transaction(signed_approve.rawTransaction)
                
                # Перевод токенов через мост
                bridge_tx = self.l1_bridge.functions.bridgeToken(
                    amount_wei,
                    1000000
                ).build_transaction({
                    'from': account.address,
                    'value': Web3.to_wei(0.01, 'ether'),  # Комиссия моста
                    'gas': 1000000,
                    'gasPrice': gas_price,
                    'nonce': self.w3_l1.eth.get_transaction_count(account.address)
                })
                
                signed_bridge = self.w3_l1.eth.account.sign_transaction(
                    bridge_tx,
                    self.user_keys[user_id]
                )
                tx_hash = self.w3_l1.eth.send_raw_transaction(signed_bridge.rawTransaction)
                
            else:  # l2_to_l1
                # Получаем текущую цену газа и увеличиваем её на 20%
                gas_price = int(self.w3_l2.eth.gas_price * 1.2)
                
                # Проверка и одобрение токенов
                allowance = self.l2_token.functions.allowance(
                    account.address,
                    ADDRESSES['l2']['bridge']
                ).call()
                
                if allowance < amount_wei:
                    # Одобрение токенов
                    approve_tx = self.l2_token.functions.approve(
                        ADDRESSES['l2']['bridge'],
                        amount_wei
                    ).build_transaction({
                        'from': account.address,
                        'gas': 100000,
                        'gasPrice': gas_price,
                        'nonce': self.w3_l2.eth.get_transaction_count(account.address)
                    })
                    
                    signed_approve = self.w3_l2.eth.account.sign_transaction(
                        approve_tx,
                        self.user_keys[user_id]
                    )
                    self.w3_l2.eth.send_raw_transaction(signed_approve.rawTransaction)
                
                # Перевод токенов через мост
                bridge_tx = self.l2_bridge.functions.bridgeToken(
                    amount_wei,
                    1000000
                ).build_transaction({
                    'from': account.address,
                    'value': Web3.to_wei(0.01, 'ether'),  # Комиссия моста
                    'gas': 1000000,
                    'gasPrice': gas_price,
                    'nonce': self.w3_l2.eth.get_transaction_count(account.address)
                })
                
                signed_bridge = self.w3_l2.eth.account.sign_transaction(
                    bridge_tx,
                    self.user_keys[user_id]
                )
                tx_hash = self.w3_l2.eth.send_raw_transaction(signed_bridge.rawTransaction)
            
            await query.edit_message_text(
                f"Перевод инициирован!\n"
                f"Хэш транзакции: {tx_hash.hex()}\n"
                f"Пожалуйста, дождитесь подтверждения."
            )
            
        except Exception as e:
            error_message = str(e)
            if "replacement transaction underpriced" in error_message:
                await query.edit_message_text(
                    "Ошибка: транзакция с таким nonce уже существует в сети.\n"
                    "Пожалуйста, подождите несколько минут и попробуйте снова."
                )
            else:
                await query.edit_message_text(f"Ошибка при выполнении перевода: {error_message}")
        
        return ConversationHandler.END

    async def manage_key(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Управление приватным ключом."""
        query = update.callback_query
        await query.answer()
        
        user_id = query.from_user.id
        keyboard = [
            [
                InlineKeyboardButton("Добавить/Обновить ключ", callback_data='add_key'),
                InlineKeyboardButton("Удалить ключ", callback_data='remove_key')
            ]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        if user_id in self.user_keys:
            await query.edit_message_text(
                "У вас установлен приватный ключ. Выберите действие:",
                reply_markup=reply_markup
            )
        else:
            await query.edit_message_text(
                "У вас не установлен приватный ключ. Пожалуйста, добавьте его:",
                reply_markup=reply_markup
            )

    async def add_key(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработка добавления/обновления приватного ключа."""
        query = update.callback_query
        await query.answer()
        
        await query.edit_message_text(
            "Пожалуйста, отправьте ваш приватный ключ (он будет храниться безопасно):"
        )
        return 'WAITING_FOR_KEY'

    async def save_key(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Сохранение предоставленного приватного ключа."""
        try:
            key = update.message.text.strip()
            if not key.startswith('0x'):
                key = '0x' + key
            
            # Проверка ключа путем создания аккаунта
            account = Account.from_key(key)
            
            # Сохранение ключа
            self.user_keys[update.effective_user.id] = key
            
            await update.message.reply_text(
                f"Приватный ключ успешно сохранен для адреса: {account.address}"
            )
            return ConversationHandler.END
            
        except Exception as e:
            await update.message.reply_text(
                f"Неверный приватный ключ: {str(e)}\nПожалуйста, попробуйте снова:"
            )
            return 'WAITING_FOR_KEY'

    async def remove_key(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Удаление сохраненного приватного ключа."""
        query = update.callback_query
        await query.answer()
        
        user_id = query.from_user.id
        if user_id in self.user_keys:
            del self.user_keys[user_id]
            await query.edit_message_text("Приватный ключ успешно удален.")
        else:
            await query.edit_message_text("Приватный ключ не был установлен.")

    async def add_key_reply(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработка добавления/обновления приватного ключа через reply-кнопку."""
        await update.message.reply_text(
            "Пожалуйста, отправьте ваш приватный ключ (он будет храниться безопасно):"
        )
        return 'WAITING_FOR_KEY'

    async def save_key_reply(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Сохранение предоставленного приватного ключа через reply-сообщение."""
        try:
            key = update.message.text.strip()
            if not key.startswith('0x'):
                key = '0x' + key
            
            # Проверка ключа путем создания аккаунта
            account = Account.from_key(key)
            
            # Сохранение ключа
            self.user_keys[update.effective_user.id] = key
            
            await update.message.reply_text(
                f"Приватный ключ успешно сохранен для адреса: {account.address}"
            )
            return ConversationHandler.END
            
        except Exception as e:
            await update.message.reply_text(
                f"Неверный приватный ключ: {str(e)}\nПожалуйста, попробуйте снова:"
            )
            return 'WAITING_FOR_KEY'

    async def remove_key_reply(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Удаление сохраненного приватного ключа через reply-кнопку."""
        user_id = update.effective_user.id
        if user_id in self.user_keys:
            del self.user_keys[user_id]
            await update.message.reply_text("Приватный ключ успешно удален.")
        else:
            await update.message.reply_text("Приватный ключ не был установлен.")

def main():
    """Запуск бота."""
    token = TELEGRAM_BOT_TOKEN
    if not token:
        raise ValueError("Токен бота не установлен")
    application = Application.builder().token(token).build()
    bot = BridgeBot(token)

    # Обработчик reply-кнопок главного меню
    application.add_handler(MessageHandler(filters.Regex("^(Проверить баланс L1|Проверить баланс L2|Перевести токены|Управление приватным ключом)$"), bot.reply_menu_handler))

    # Обработчик управления ключом
    key_conv = ConversationHandler(
        entry_points=[
            MessageHandler(filters.Regex("^Добавить/Обновить ключ$"), bot.add_key_reply),
            MessageHandler(filters.Regex("^Удалить ключ$"), bot.remove_key_reply),
            MessageHandler(filters.Regex("^Назад$"), bot.start)
        ],
        states={
            'WAITING_FOR_KEY': [
                MessageHandler(filters.TEXT & ~filters.COMMAND, bot.save_key_reply),
                MessageHandler(filters.Regex("^Назад$"), bot.start)
            ]
        },
        fallbacks=[CommandHandler('start', bot.start)]
    )
    application.add_handler(key_conv)

    # Добавление обработчика диалога для переводов
    transfer_conv = ConversationHandler(
        entry_points=[CallbackQueryHandler(bot.enter_amount, pattern='^l[12]_to_l[12]$')],
        states={
            ENTERING_AMOUNT: [MessageHandler(filters.TEXT & ~filters.COMMAND, bot.confirm_transfer)],
            CONFIRMING_TRANSFER: [CallbackQueryHandler(bot.execute_transfer, pattern='^(confirm|cancel)_transfer$')]
        },
        fallbacks=[CommandHandler('start', bot.start)]
    )

    # Добавление обработчиков
    application.add_handler(CommandHandler("start", bot.start))
    application.add_handler(transfer_conv)

    # Запуск бота
    application.run_polling()

if __name__ == '__main__':
    main() 