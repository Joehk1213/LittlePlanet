# LittlePlanet 小行星會員中心 - 認證與登入系統開發記錄

## 一、 系統架構總覽

- **前端**：`public/customer.html`（提供 Google 登入、手機手動登入、歷史訂單檢視及一鍵認領介面）。
    
      
    
- **後端**：`index.js`（Express 伺服器，內置 Zero-dependency Cookie 解析器、API 防護與路由託管）。
    
      
    
- **Session 驗證中介軟體**：`middleware/customer-session.js`（負責 Cookie 簽章驗證與登入身份格式檢查）。
    
      
    
- **資料庫**：Supabase (`orders` 表格與 `link_customer_phone_orders` RPC 函數）。
    
      
    

## 二、 核心問題與解決方案（已完成部分）

### 1. 後端 Cookie 解析失效

- **問題**：前端透過 Supabase SDK 成功以 Google 登入，但後端 Express 未能讀取 Cookie，導致 API 頻繁報錯「會員工作階段已失效」。
    
      
    
- **解決**：於 `index.js` 中實作內置零依賴的 Cookie 解析器，確保 Express 能順利從 `req.headers.cookie` 提取 Session。
    
      
    

### 2. Session 驗證格式過嚴（卡住 Google 身份字串）

- **問題**：`middleware/customer-session.js` 原本僅允許 8-15 位純數字的手機號碼格式，導致 Google 登入回傳的 `email|google|id` 格式被拒絕。
    
      
    
- **解決**：修改正規表達式及判斷條件，使其**同時支援** 8-15 位純數字電話，以及包含 `|google|` 的 Google 帳號身份字串。
    
      
    

### 3. 歷史訂單一鍵認領與 Supabase RPC 函數修正

- **問題**：
    
      
    - 早期 RPC 函數錯誤參照 `id` 欄位導致 `column "id" does not exist`。
        
          
        
    - 資料庫 `order_id` 為 UUID 型別，與前端傳入的文字比對時引發 `operator does not exist: uuid = text` 錯誤。
        
          
        
    - 欄位名稱對應錯誤（資料庫實際記錄訂單編號的欄位為 `order_number`）。
        
          
        
- **解決**：在 Supabase 重新建立 `link_customer_phone_orders` 函數，精準對應 `order_number` 與 `customer_phone` 進行綁定。
    
      
    

## 三、 下一步：Facebook Auth 實作計畫

### 1. Meta 平台設定

- 前往 [Meta for Developers](https://developers.facebook.com/) 建立應用程式。
    
      
    
- 開啟 **Facebook Login** 功能。
    
      
    
- 設定 **Valid OAuth Redirect URIs**（填入 Supabase 提供的 Callback URL）。
    
      
    
- 取得 **App ID (Client ID)** 與 **App Secret (Client Secret)**。
    
      
    

### 2. Supabase 後台啟用

- 進入 Supabase Auth Providers 頁面，啟用 **Facebook**。
    
      
    
- 填入對應的 Client ID 與 Client Secret 並儲存。
    
      
    

### 3. 程式碼相容性調整

- 確保 `middleware/customer-session.js` 的驗證條件未來可順暢支援 Facebook 的身份字串格式（例如包含 `|facebook|`）。
    
      
e.g這代表在貼上程式碼時，routes/customer.js 裡面的 try 和 catch 區塊大括號（{}）發生了錯位或漏掉了 catch。

我成日都見到 俾D CODE 
try 和 catch 區塊大括號（{}）發生了錯位或漏掉了 catch。
try 和 catch 區塊大括號（{}）發生了錯位或漏掉了 catch。
try 和 catch 區塊大括號（{}）發生了錯位或漏掉了 catch。
try 和 catch 區塊大括號（{}）發生了錯位或漏掉了 catch。
try 和 catch 區塊大括號（{}）發生了錯位或漏掉了 catch。
try 和 catch 區塊大括號（{}）發生了錯位或漏掉了 catch。

RECORD 呢句 下次READ 完.md後 唔好再低級錯誤 唔好再死呢樣野
----------------------------------------------------
20261018

# 網店專案（LittlePlanet）測試發現與待修正清單

## 專案目前狀態
- 已還原至穩定版本（Google 登入、手機驗證與歷史訂單功能 100% 正常運作）。
- 已暫停 Facebook 登入功能開發。
- 採用手動 Copy 資料夾及 VS Code Timeline 作為主要備份機制。

---

## 待跟進與優化項目（Testing Notes）

### 1. 客人下單完成後的顯示問題
- **現狀**：客人完成下單的第一時間，畫面顯示的是資料庫內部的 `UUID`。
- **目標**：改為顯示易讀且美觀的訂單編號（Order No.，例如 `LP-20261017-0003`）。
- **影響範圍**：結帳 API / 下單成功頁面（`routes/orders.js` 或相關後端處理邏輯）。

### 2. 非會員/訪客「單筆查詢」安全性漏洞
- **現狀**：未登入或未建立會員的訪客在查詢訂單時，輸入「電話號碼」或「訂單編號」其中一項即可查到資料（`OR` 邏輯）。
- **目標**：修復安全性漏洞，改為必須「同時輸入正確的電話號碼 AND 訂單編號」才能放行查詢（`AND` 嚴格驗證）。
- **影響範圍**：單筆訂單查詢 API（`routes/orders.js`）。

---
請協助針對以上兩點，逐步檢查後端程式碼並進行安全優化。