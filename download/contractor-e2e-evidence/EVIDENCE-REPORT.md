# Contractor E2E Evidence Report

**Generated:** 2026-08-05T17:45:44.805138

**Evidence directory:** `/home/z/my-project/download/contractor-e2e-evidence`

---

## 01_Save

**Timestamp:** 2026-08-05T17:44:58.043798

**Request ID:** `ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb`

**Ref Number:** `TR-2026-000022`

**API Endpoint:** `POST /api/requests`

**HTTP Status:** `201`

**DB Status Before:** `N/A (new request)`

**DB Status After:** `DRAFT`

**Notifications Before:**
```json
{
  "contractor_notifs": 0,
  "coord_notifs": {
    "e587af7b-8a9e-4107-9cb2-f6fe5e3529ce": 0,
    "5b58d83a-d035-4efa-aa2e-b44fd55b0711": 0
  }
}
```

**Notifications After:**
```json
{
  "contractor_notifs": 0,
  "coord_notifs": {
    "e587af7b-8a9e-4107-9cb2-f6fe5e3529ce": 0,
    "5b58d83a-d035-4efa-aa2e-b44fd55b0711": 0
  }
}
```

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/02-save-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/02-save-after.png`

**Console Logs (2):**
```
  [warning] Select is changing from uncontrolled to controlled. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using
  [warning] Select is changing from controlled to uncontrolled. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using
```

**Network Requests (6):**
```
  [GET] — http://localhost:3000/api/courses?pageSize=100
  [GET] 200 http://localhost:3000/api/courses?pageSize=100
  [POST] — http://localhost:3000/api/requests
  [POST] 201 http://localhost:3000/api/requests
  [GET] — http://localhost:3000/api/requests?page=1&pageSize=10
  [GET] 200 http://localhost:3000/api/requests?page=1&pageSize=10
```

---

## 02_EditDraft

**Timestamp:** 2026-08-05T17:45:04.125087

**Request ID:** `ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb`

**Ref Number:** `TR-2026-000022`

**API Endpoint:** `PUT /api/requests/[id]`

**HTTP Status:** `200`

**DB Status Before:** `DRAFT`

**DB Status After:** `DRAFT`

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/03-edit-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/03-edit-after.png`

**Console Logs (1):**
```
  [warning] Select is changing from controlled to uncontrolled. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using
```

**Network Requests (6):**
```
  [GET] — http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb
  [GET] 200 http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb
  [PUT] — http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb
  [PUT] 200 http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb
  [GET] — http://localhost:3000/api/requests?page=1&pageSize=10
  [GET] 200 http://localhost:3000/api/requests?page=1&pageSize=10
```

---

## 03_Send

**Timestamp:** 2026-08-05T17:45:09.747808

**Request ID:** `ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb`

**Ref Number:** `TR-2026-000022`

**API Endpoint:** `POST /api/requests/[id]/transition`

**HTTP Status:** `200`

**DB Status Before:** `DRAFT`

**DB Status After:** `SUBMITTED`

**Notifications Before:**
```json
{
  "e587af7b-8a9e-4107-9cb2-f6fe5e3529ce": 0,
  "5b58d83a-d035-4efa-aa2e-b44fd55b0711": 0
}
```

**Notifications After:**
```json
{
  "e587af7b-8a9e-4107-9cb2-f6fe5e3529ce": 1,
  "5b58d83a-d035-4efa-aa2e-b44fd55b0711": 1
}
```

**Coordinator Notification Records:**
```json
[
  {
    "id": "b0af818d-f768-45e1-a202-07dacd9c0b1e",
    "title": "New Training Request Submitted",
    "titleAr": "\u0637\u0644\u0628 \u062a\u062f\u0631\u064a\u0628 \u062c\u062f\u064a\u062f",
    "message": "Training request TR-2026-000022 has been submitted and is awaiting your review.",
    "type": "INFO",
    "category": "TRAINING",
    "isRead": false,
    "createdAt": "2026-08-05T17:45:05.171Z"
  }
]
```

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/04-send-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/04-send-after.png`

**Console Logs:** None

**Network Requests (4):**
```
  [POST] — http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb/transition
  [POST] 200 http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb/transition
  [GET] — http://localhost:3000/api/requests?page=1&pageSize=10
  [GET] 200 http://localhost:3000/api/requests?page=1&pageSize=10
```

---

## 04_ExportExcel

**Timestamp:** 2026-08-05T17:45:14.790597

**Request ID:** `ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb`

**API Endpoint:** `/api/export/company-data?scope=specific_request&specificId=ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb&items=requests%2Ctrainees%2Cattendance%2Cresults%2Cevaluations%2Ccertificates%2Cinvoices%2Cattachments&format=excel&locale=en`

**HTTP Status:** `200`

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/05-export-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/05-export-after.png`

**Console Logs:** None

**Network Requests (2):**
```
  [GET] — http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb
  [GET] 200 http://localhost:3000/api/requests/ba5cdd23-e702-4ff9-bdc5-2738ea71e9cb
```

---

## 05_SavePlusSend

**Timestamp:** 2026-08-05T17:45:27.859730

**Request ID:** `0e850b31-a087-46d1-a988-7819ab260d35`

**Ref Number:** `TR-2026-000023`

**API Endpoint:** `POST /api/requests (with status=SUBMITTED)`

**HTTP Status:** `201`

**DB Status After:** `SUBMITTED`

**Notifications Before:**
```json
{
  "e587af7b-8a9e-4107-9cb2-f6fe5e3529ce": 0,
  "5b58d83a-d035-4efa-aa2e-b44fd55b0711": 0
}
```

**Notifications After:**
```json
{
  "e587af7b-8a9e-4107-9cb2-f6fe5e3529ce": 1,
  "5b58d83a-d035-4efa-aa2e-b44fd55b0711": 1
}
```

**Coordinator Notification Records:**
```json
[
  {
    "id": "2a82a824-830a-417a-88d7-978d2b18bc1f",
    "title": "New Training Request Submitted",
    "titleAr": "\u0637\u0644\u0628 \u062a\u062f\u0631\u064a\u0628 \u062c\u062f\u064a\u062f",
    "message": "Training request TR-2026-000023 has been submitted and is awaiting your review.",
    "type": "INFO",
    "category": "TRAINING",
    "isRead": false,
    "createdAt": "2026-08-05T17:45:23.441Z"
  }
]
```

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/06-combo-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/06-combo-after.png`

**Console Logs (2):**
```
  [warning] Select is changing from uncontrolled to controlled. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using
  [warning] Select is changing from controlled to uncontrolled. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using
```

**Network Requests (6):**
```
  [GET] — http://localhost:3000/api/courses?pageSize=100
  [GET] 200 http://localhost:3000/api/courses?pageSize=100
  [POST] — http://localhost:3000/api/requests
  [POST] 201 http://localhost:3000/api/requests
  [GET] — http://localhost:3000/api/requests?page=1&pageSize=10
  [GET] 200 http://localhost:3000/api/requests?page=1&pageSize=10
```

---

## 06_Notifications

**Timestamp:** 2026-08-05T17:45:30.227657

**API Endpoint:** `GET /api/notifications`

**HTTP Status:** `200`

**DB Notification Records (first 5):**
```json
[
  {
    "id": "5edbce75-4ca8-4b87-afb0-f34b8f51628f",
    "title": "Request Returned for Revision",
    "titleAr": "\u062a\u0645 \u0625\u0631\u062c\u0627\u0639 \u0627\u0644\u0637\u0644\u0628 \u0644\u0644\u062a\u0639\u062f\u064a\u0644",
    "message": "Training request TR-1785631076447 has been returned for revision. Reason: \u0627\u0631\u0641\u0642 \u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a",
    "type": "WARNING",
    "category": "TRAINING",
    "isRead": false,
    "createdAt": "2026-08-03T20:54:15.111Z"
  },
  {
    "id": "393fb64c-6949-4866-bf7f-ce4db7385fee",
    "title": "Certificate Printing Released",
    "titleAr": "\u062a\u0645 \u0627\u0644\u0633\u0645\u0627\u062d \u0628\u0637\u0628\u0627\u0639\u0629 \u0627\u0644\u0634\u0647\u0627\u062f\u0627\u062a",
    "message": "Certificate printing has been released for session SES-000004. You can now download certificates.",
    "type": "SUCCESS",
    "category": "FINANCIAL",
    "isRead": true,
    "createdAt": "2026-08-02T20:08:40.525Z"
  },
  {
    "id": "2559438e-5d0c-4768-953c-2768b51e2c41",
    "title": "Assessment Failed",
    "titleAr": "\u0631\u0633\u0648\u0628 \u0641\u064a \u0627\u0644\u062a\u0642\u064a\u064a\u0645",
    "message": "Trainee Retest Trainee (First Aid) failed the final assessment with 45%. A retest is required.",
    "type": "WARNING",
    "category": "TRAINING",
    "isRead": true,
    "createdAt": "2026-08-02T19:29:23.561Z"
  },
  {
    "id": "a3e9f254-aac0-4452-a169-58a659e31f25",
    "title": "Assessment Failed",
    "titleAr": "\u0631\u0633\u0648\u0628 \u0641\u064a \u0627\u0644\u062a\u0642\u064a\u064a\u0645",
    "message": "Trainee Retest Trainee (First Aid) failed the final assessment with 45%. A retest is required.",
    "type": "WARNING",
    "category": "TRAINING",
    "isRead": true,
    "createdAt": "2026-08-02T19:29:23.324Z"
  },
  {
    "id": "3597965d-7d92-45b1-bbcf-e0a420cc4fb3",
    "title": "Retest Failed \u2014 Training Request Closed",
    "titleAr": "\u0631\u0633\u0648\u0628 \u0641\u064a \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0627\u062e\u062a\u0628\u0627\u0631 \u2014 \u062a\u0645 \u0625\u063a\u0644\u0627\u0642 \u0637\u0644\u0628 \u0627\u0644\u062a\u062f\u0631\u064a\u0628",
    "message": "Trainee Retest Trainee failed the official retest. The training request is now closed. A new training request and payment are required for any further attempts.",
    "type": "ERROR",
    "category": "TRAINING",
    "isRead": true,
    "createdAt": "2026-08-02T19:22:05.099Z"
  }
]
```

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/07-notif-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/07-notif-after.png`

**Console Logs:** None

**Network Requests (2):**
```
  [GET] — http://localhost:3000/api/notifications?pageSize=5
  [GET] 200 http://localhost:3000/api/notifications?pageSize=5
```

---

## 07_UploadExcel

**Timestamp:** 2026-08-05T17:45:35.954485

**API Endpoint:** `N/A (dialog open only — file upload requires user file selection)`

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/08-import-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/08-import-after.png`

**Console Logs:** None

---

## 08_UploadAttachments

**Timestamp:** 2026-08-05T17:45:42.882519

**API Endpoint:** `POST /api/trainees/upload-id or /api/requests/upload-doc (when file selected)`

**Screenshot Before:** `/home/z/my-project/download/contractor-e2e-evidence/09-upload-before.png`

**Screenshot After:** `/home/z/my-project/download/contractor-e2e-evidence/09-upload-after.png`

**Console Logs (1):**
```
  [warning] Select is changing from uncontrolled to controlled. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using
```

**Network Requests (2):**
```
  [GET] — http://localhost:3000/api/courses?pageSize=100
  [GET] 200 http://localhost:3000/api/courses?pageSize=100
```

---

## Summary

- Total tests: 8
- Evidence files: `/home/z/my-project/download/contractor-e2e-evidence/`
- Screenshots: all `*.png` files in evidence directory
- Exported Excel: `export-contractor.xlsx`
