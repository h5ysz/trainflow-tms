#!/usr/bin/env python3
"""
Generate Arabic translations for all i18n keys in /tmp/en-keys.txt
and write them to /tmp/ar-translations.json

Domain: Training Management System (GCC Lab)
Locale: Arabic (ar) — formal, Modern Standard Arabic
"""

import json
import sys
from pathlib import Path


# --------------------------------------------------------------------------- #
# Comprehensive Arabic translations for all 817 keys
# --------------------------------------------------------------------------- #
TRANSLATIONS = {
    # ---- app (1-3) ----
    "app.name": "مختبر الخليج",
    "app.tagline": "نظام إدارة التدريب",
    "app.shortcut": "ابحث أو انتقل إلى...",

    # ---- auth (4-14) ----
    "auth.signIn": "تسجيل الدخول",
    "auth.signOut": "تسجيل الخروج",
    "auth.email": "البريد الإلكتروني",
    "auth.password": "كلمة المرور",
    "auth.rememberMe": "إبقائي مسجَّلاً للدخول",
    "auth.forgotPassword": "هل نسيت كلمة المرور؟",
    "auth.welcomeBack": "مرحباً بعودتك",
    "auth.signInSubtitle": "سجِّل الدخول لإدارة برامجك التدريبية",
    "auth.demoTitle": "اختر دوراً تجريبياً لاستكشاف النظام",
    "auth.invalidCredentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    "auth.signInWithRole": "المتابعة بدور {role}",

    # ---- roles (15-27) ----
    "role.SUPER_ADMIN": "مدير عام",
    "role.COMPANY_ADMIN": "مدير شركة",
    "role.COORDINATOR": "منسِّق",
    "role.TRAINER": "مدرِّب",
    "role.AUDITOR": "مُدقِّق",
    "role.CONTRACTOR": "مقاول",
    "role.VIEWER": "مشاهد",
    "role.SUPER_ADMIN.desc": "وصول كامل للنظام بما في ذلك الإعدادات",
    "role.COMPANY_ADMIN.desc": "إدارة الشركات المُخصَّصة وعرض التقارير",
    "role.COORDINATOR.desc": "إدارة عمليات التدريب (بدون الإعدادات)",
    "role.TRAINER.desc": "تقديم الجلسات وتصحيح التقييمات",
    "role.AUDITOR.desc": "وصول للقراءة فقط للامتثال والتدقيق",
    "role.CONTRACTOR.desc": "تقديم ومتابعة طلبات التدريب",

    # ---- navigation (28-60) ----
    "nav.group.dashboard": "",
    "nav.group.training": "عمليات التدريب",
    "nav.group.assessment": "التقييم",
    "nav.group.reports": "التقارير",
    "nav.group.system": "النظام",
    "nav.dashboard": "لوحة التحكم",
    "nav.companies": "الشركات",
    "nav.companyContacts": "جهات اتصال الشركات",
    "nav.trainers": "المدرِّبون",
    "nav.trainerQualifications": "مؤهلات المدرِّبين",
    "nav.trainees": "المتدرِّبون",
    "nav.courses": "الدورات التدريبية",
    "nav.requests": "طلبات التدريب",
    "nav.sessions": "الجلسات التدريبية",
    "nav.scheduling": "الجدولة",
    "nav.attendance": "الحضور",
    "nav.qrCode": "رمز QR",
    "nav.preTest": "الاختبار القبلي",
    "nav.finalTest": "الاختبار النهائي",
    "nav.evaluation": "تقييم الدورة",
    "nav.certificates": "الشهادات",
    "nav.reports": "التقارير",
    "nav.reportSchedules": "جداول التقارير",
    "nav.notifications": "الإشعارات",
    "nav.auditLog": "سجل التدقيق",
    "nav.settings": "الإعدادات",
    "nav.userApprovals": "موافقات المستخدمين",
    "nav.userManagement": "إدارة المستخدمين",
    "nav.roles": "الأدوار والصلاحيات",
    "nav.workerPassports": "جوازات العمال",
    "nav.complianceMatrix": "مصفوفة الامتثال",
    "nav.executiveDashboard": "لوحة تحكم الإدارة التنفيذية",
    "nav.renewalDashboard": "مركز التجديد",

    # ---- actions (61-94) ----
    "action.create": "إنشاء",
    "action.new": "جديد",
    "action.add": "إضافة",
    "action.edit": "تحرير",
    "action.delete": "حذف",
    "action.save": "حفظ",
    "action.cancel": "إلغاء",
    "action.close": "إغلاق",
    "action.confirm": "تأكيد",
    "action.view": "عرض",
    "action.details": "التفاصيل",
    "action.search": "بحث",
    "action.filter": "تصفية",
    "action.export": "تصدير",
    "action.import": "استيراد",
    "action.download": "تنزيل",
    "action.print": "طباعة",
    "action.refresh": "تحديث",
    "action.back": "رجوع",
    "action.next": "التالي",
    "action.previous": "السابق",
    "action.approve": "اعتماد",
    "action.reject": "رفض",
    "action.schedule": "جدولة",
    "action.assign": "تعيين",
    "action.issue": "إصدار",
    "action.revoke": "إبطال",
    "action.send": "إرسال",
    "action.markAllRead": "تعليم الكل كمقروء",
    "action.more": "المزيد",
    "action.actions": "إجراءات",
    "action.selectAll": "تحديد الكل",
    "action.clearFilters": "مسح التصفية",
    "action.apply": "تطبيق",

    # ---- table (95-107) ----
    "table.empty": "لا توجد سجلات",
    "table.empty.subtitle": "ابدأ بإنشاء سجلك الأول",
    "table.loading": "جارٍ التحميل...",
    "table.noResults": "لا توجد نتائج مطابقة",
    "table.rowsPerPage": "صفوف لكل صفحة",
    "table.of": "من",
    "table.page": "صفحة",
    "table.selected": "محدد",
    "table.column.name": "الاسم",
    "table.column.status": "الحالة",
    "table.column.actions": "إجراءات",
    "table.column.createdAt": "تاريخ الإنشاء",
    "table.column.updatedAt": "تاريخ التحديث",

    # ---- status (108-130) ----
    "status.ACTIVE": "نشط",
    "status.INACTIVE": "غير نشط",
    "status.SUSPENDED": "موقوف",
    "status.DRAFT": "مسودة",
    "status.PENDING": "قيد الانتظار",
    "status.SUBMITTED": "مُقدَّم",
    "status.UNDER_REVIEW": "قيد المراجعة",
    "status.APPROVED": "معتمد",
    "status.REJECTED": "مرفوض",
    "status.SCHEDULED": "مجدول",
    "status.IN_PROGRESS": "قيد التنفيذ",
    "status.COMPLETED": "مكتمل",
    "status.CANCELLED": "ملغى",
    "status.NO_SHOW": "لم يحضر",
    "status.VALID": "ساري",
    "status.EXPIRED": "منتهٍ",
    "status.EXPIRING_SOON": "ينتهي قريباً",
    "status.REVOKED": "مُبطَل",
    "status.PRESENT": "حاضر",
    "status.ABSENT": "غائب",
    "status.LATE": "متأخر",
    "status.EXCUSED": "بعذر",
    "status.REGISTERED": "مسجَّل",

    # ---- workflow (131-139) ----
    "workflow.submit": "إرسال",
    "workflow.review": "بدء المراجعة",
    "workflow.approve": "اعتماد",
    "workflow.schedule": "تعليم كمجدول",
    "workflow.start": "بدء الجلسة",
    "workflow.complete": "إكمال",
    "workflow.cancel": "إلغاء",
    "workflow.reject": "رفض",
    "workflow.resubmit": "إعادة الإرسال",

    # ---- trainees (140-155) ----
    "trainees.title": "المتدرِّبون",
    "trainees.subtitle": "إدارة ملفات المتدرِّبين المسجَّلين في الشركات",
    "trainees.new": "متدرِّب جديد",
    "trainees.edit": "تحرير متدرِّب",
    "trainees.fullName": "الاسم الكامل",
    "trainees.nationalId": "رقم الهوية / الإقامة",
    "trainees.nationality": "الجنسية",
    "trainees.jobTitle": "المسمى الوظيفي",
    "trainees.mobile": "الجوال",
    "trainees.email": "البريد الإلكتروني",
    "trainees.company": "الشركة",
    "trainees.status": "الحالة",
    "trainees.notes": "ملاحظات",
    "trainees.empty.title": "لا يوجد متدرِّبون بعد",
    "trainees.empty.subtitle": "أضف المتدرِّبين لتسجيلهم في طلبات التدريب",
    "trainees.duplicate": "يوجد متدرِّب بنفس رقم الهوية مسبقاً",

    # ---- certifications (156-171) ----
    "certifications.title": "شهادات المدرِّبين",
    "certifications.subtitle": "ربط المدرِّبين بالدورات المعتمَدين لتدريسها",
    "certifications.new": "شهادة جديدة",
    "certifications.import": "استيراد",
    "certifications.export": "تصدير",
    "certifications.import.success": "اكتمل الاستيراد: تم إنشاء {created} شهادة، {skipped} موجودة مسبقاً",
    "certifications.trainer": "المدرِّب",
    "certifications.course": "الدورة",
    "certifications.qualification": "المؤهل المصدر",
    "certifications.validFrom": "ساري من",
    "certifications.validUntil": "ساري حتى",
    "certifications.status": "الحالة",
    "certifications.edit": "تحرير الشهادة",
    "certifications.notes": "ملاحظات",
    "certifications.empty.title": "لا توجد شهادات بعد",
    "certifications.empty.subtitle": "لا يمكن تعيين المدرِّبين بدون شهادات للجلسات",

    # ---- requests (partial: courses + trainee count + validation) (172-178) ----
    "requests.courses": "الدورات في الطلب",
    "requests.addCourse": "إضافة دورة",
    "requests.traineeCount": "عدد المتدرِّبين",
    "requests.minTrainees": "الحد الأدنى: 10",
    "requests.maxTrainees": "الحد الأقصى: 20",
    "requests.validation.minTrainees": "يجب أن تحتوي كل دورة على 10 متدرِّبين على الأقل قبل الاعتماد",
    "requests.validation.maxTrainees": "لا يمكن أن تحتوي كل دورة على أكثر من 20 متدرِّباً",

    # ---- sessions (partial: 179-199) ----
    "sessions.city": "المدينة",
    "sessions.region": "المنطقة",
    "sessions.venue": "المكان",
    "sessions.shift": "الوردية",
    "sessions.shift.MORNING": "صباحية",
    "sessions.shift.EVENING": "مسائية",
    "sessions.durationHours": "المدة (ساعات)",
    "sessions.capacity": "السعة",
    "sessions.assignTrainer": "تعيين مدرِّب",
    "sessions.generateFromRequest": "توليد جلسات من الطلب",
    "sessions.conflict.warning": "يوجد تعارض في جدول المدرِّب",
    "sessions.notCertified.warning": "المدرِّب غير معتمد لهذه الدورة",
    "sessions.instituteName": "الجهة المنفِّذة",
    "sessions.classification": "التصنيف",
    "sessions.classification.COURSE": "دورة",
    "sessions.classification.EXAM": "امتحان",
    "sessions.mapLink": "رابط خريطة الموقع",
    "sessions.durationDays": "المدة (أيام)",
    "sessions.import": "استيراد",
    "sessions.export": "تصدير",
    "sessions.import.success": "اكتمل الاستيراد: تم استيراد {imported}، فشل {failed}",

    # ---- dashboard KPIs (200-208) ----
    "dashboard.kpi.pendingRequests": "الطلبات المعلقة",
    "dashboard.kpi.underReviewRequests": "قيد المراجعة",
    "dashboard.kpi.approvedRequests": "الطلبات المعتمدة",
    "dashboard.kpi.scheduledSessions": "الجلسات المجدولة",
    "dashboard.kpi.todaySessions": "جلسات اليوم",
    "dashboard.kpi.availableTrainers": "المدرِّبون المتاحون",
    "dashboard.kpi.trainerConflicts": "تعارضات المدرِّبين",
    "dashboard.kpi.companies": "الشركات",
    "dashboard.kpi.trainees": "المتدرِّبون",

    # ---- exam (209-237) ----
    "exam.title": "محاولات الامتحان",
    "exam.subtitle": "إدارة محاولات الاختبار القبلي والنهائي بمجموعات أسئلة عشوائية",
    "exam.start": "بدء الامتحان",
    "exam.submit": "إرسال الإجابات",
    "exam.attempt": "محاولة",
    "exam.result": "نتيجة الامتحان",
    "exam.progress": "تمت الإجابة",
    "exam.pickOne": "اختر إجابة واحدة",
    "exam.pickMany": "اختر كل ما ينطبق",
    "exam.maxAttempts": "استنفد هذا المتدرِّب جميع المحاولات المتاحة",
    "exam.sessionNotCompleted": "يجب إكمال الجلسة قبل إجراء الاختبار النهائي",
    "exam.invalidStatus": "لا يمكن بدء هذه المحاولة في حالتها الحالية",
    "exam.empty.title": "لا توجد محاولات امتحان",
    "exam.empty.subtitle": "تُنشأ المحاولات عندما تعيِّن الجلسة اختباراتها",
    "exam.attemptNumber": "محاولة",
    "exam.status.ASSIGNED": "معيَّن",
    "exam.status.IN_PROGRESS": "قيد التنفيذ",
    "exam.status.SUBMITTED": "مُقدَّم",
    "exam.status.GRADED": "تم التصحيح",
    "exam.passed": "ناجح",
    "exam.failed": "راسب",
    "exam.score": "الدرجة",
    "exam.passScore": "درجة النجاح",
    "exam.duration": "المدة",
    "exam.questions": "الأسئلة",
    "exam.noQuestions": "لا توجد أسئلة متاحة في بنك الأسئلة لهذه الدورة",
    "exam.finalTestLocked": "الاختبار النهائي مقفل حتى تُكتمَل الجلسة",
    "exam.preTestAssigned": "تُعيِّن الاختبار القبلي تلقائياً بعد تسجيل الحضور",
    "exam.finalTestAssigned": "تُعيِّن الاختبار النهائي تلقائياً بعد إكمال الجلسة",

    # ---- lifecycle (238-249) ----
    "lifecycle.title": "دورة حياة الجلسة",
    "lifecycle.subtitle": "تتبُّع تقدُّم الجلسة: بدء ← استراحة ← استئناف ← إكمال",
    "lifecycle.STARTED": "بدء الجلسة",
    "lifecycle.BREAK": "بدء الاستراحة",
    "lifecycle.RESUMED": "استئناف الجلسة",
    "lifecycle.COMPLETED": "إكمال الجلسة",
    "lifecycle.NOT_STARTED": "لم تبدأ",
    "lifecycle.ON_BREAK": "في الاستراحة",
    "lifecycle.COMPLETED_STATUS": "مكتملة",
    "lifecycle.events": "أحداث دورة الحياة",
    "lifecycle.eventTime": "الوقت",
    "lifecycle.eventType": "الحدث",

    # ---- certificate eligibility (250-259) ----
    "certificate.eligibility.title": "أهلية الشهادة",
    "certificate.eligibility.attendance": "اكتمل الحضور",
    "certificate.eligibility.finalTest": "اجتياز الاختبار النهائي",
    "certificate.eligibility.evaluation": "تم تقديم التقييم",
    "certificate.eligibility.allMet": "تحققت جميع الشروط — مؤهل للحصول على الشهادة",
    "certificate.eligibility.notMet": "لم تتحقق جميع الشروط بعد",
    "certificate.generatePdf": "إنشاء PDF",
    "certificate.downloadPdf": "تنزيل PDF",
    "certificate.bulkGenerate": "إنشاء شهادات بالجملة",
    "certificate.eligibilityFailed": "لا يمكن إصدار الشهادة: لم يكمل المتدرِّب جميع الخطوات المطلوبة",

    # ---- attendance (260-269) ----
    "attendance.checkIn": "تسجيل الحضور (QR)",
    "attendance.deviceInfo": "معلومات الجهاز",
    "attendance.preTestAssigned": "تم تعيين الاختبار القبلي",
    "attendance.finalTestPassed": "اجتاز الاختبار النهائي",
    "attendance.evaluationCompleted": "اكتمل التقييم",
    "attendance.certificateEligible": "مؤهل للشهادة",
    "attendance.progress": "التقدُّم",
    "attendance.qrNotActive": "رمز QR غير نشط بعد",
    "attendance.qrExpired": "انتهت صلاحية رمز QR",
    "attendance.duplicateCheckIn": "سجَّل المتدرِّب حضوره مسبقاً",

    # ---- priority (270-273) ----
    "priority.LOW": "منخفض",
    "priority.NORMAL": "عادي",
    "priority.HIGH": "مرتفع",
    "priority.URGENT": "عاجل",

    # ---- dashboard (274-292) ----
    "dashboard.title": "لوحة التحكم",
    "dashboard.subtitle": "نظرة عامة على عمليات التدريب والمؤشرات الرئيسية",
    "dashboard.kpi.totalSessions": "إجمالي الجلسات",
    "dashboard.kpi.activeTrainees": "المتدرِّبون النشطون",
    "dashboard.kpi.issuedCertificates": "الشهادات الصادرة",
    "dashboard.kpi.expiringCerts": "الشهادات قاربت على الانتهاء",
    "dashboard.kpi.activeTrainers": "المدرِّبون النشطون",
    "dashboard.kpi.completionRate": "معدل الإكمال",
    "dashboard.kpi.avgScore": "متوسط الدرجة",
    "dashboard.chart.sessionsByMonth": "الجلسات حسب الشهر",
    "dashboard.chart.certificatesByCourse": "الشهادات حسب الدورة",
    "dashboard.chart.requestsByStatus": "الطلبات حسب الحالة",
    "dashboard.chart.attendanceTrend": "اتجاه الحضور",
    "dashboard.recentActivity": "النشاط الأخير",
    "dashboard.upcomingSessions": "الجلسات القادمة",
    "dashboard.quickActions": "إجراءات سريعة",
    "dashboard.viewAll": "عرض الكل",
    "dashboard.welcome": "مرحباً بعودتك، {name}",
    "dashboard.welcomeSubtitle": "إليك ما يحدث في برامجك التدريبية اليوم.",

    # ---- companies (293-318) ----
    "companies.title": "الشركات",
    "companies.subtitle": "إدارة شركات المقاولين وملفاتهم",
    "companies.new": "شركة جديدة",
    "companies.edit": "تحرير الشركة",
    "companies.name": "اسم الشركة",
    "companies.nameAr": "الاسم بالعربية",
    "companies.legalName": "الاسم القانوني",
    "companies.crNumber": "رقم السجل التجاري",
    "companies.vatNumber": "الرقم الضريبي",
    "companies.industry": "القطاع",
    "companies.country": "الدولة",
    "companies.city": "المدينة",
    "companies.address": "العنوان",
    "companies.postalCode": "الرمز البريدي",
    "companies.phone": "الهاتف",
    "companies.email": "البريد الإلكتروني",
    "companies.website": "الموقع الإلكتروني",
    "companies.contactPerson": "الشخص المسؤول",
    "companies.contactPhone": "هاتف المسؤول",
    "companies.contactEmail": "بريد المسؤول الإلكتروني",
    "companies.status": "الحالة",
    "companies.contacts": "جهات الاتصال",
    "companies.users": "المستخدمون",
    "companies.requests": "الطلبات",
    "companies.empty.title": "لا توجد شركات بعد",
    "companies.empty.subtitle": "أضف أول شركة مقاولين لبدء إدارة طلبات التدريب",

    # ---- contacts (319-333) ----
    "contacts.title": "جهات اتصال الشركات",
    "contacts.subtitle": "إدارة الأشخاص المسؤولين في شركات المقاولين",
    "contacts.new": "جهة اتصال جديدة",
    "contacts.edit": "تحرير جهة الاتصال",
    "contacts.fullName": "الاسم الكامل",
    "contacts.jobTitle": "المسمى الوظيفي",
    "contacts.company": "الشركة",
    "contacts.email": "البريد الإلكتروني",
    "contacts.phone": "الهاتف",
    "contacts.mobile": "الجوال",
    "contacts.isPrimary": "جهة الاتصال الرئيسية",
    "contacts.isActive": "نشط",
    "contacts.notes": "ملاحظات",
    "contacts.empty.title": "لا توجد جهات اتصال بعد",
    "contacts.empty.subtitle": "أضف الأشخاص المسؤولين إلى شركات المقاولين",

    # ---- trainers (334-355) ----
    "trainers.title": "المدرِّبون",
    "trainers.subtitle": "إدارة ملفات المدرِّبين وتعييناتهم",
    "trainers.new": "مدرِّب جديد",
    "trainers.edit": "تحرير مدرِّب",
    "trainers.fullName": "الاسم الكامل",
    "trainers.fullNameAr": "الاسم بالعربية",
    "trainers.nationalId": "رقم الهوية",
    "trainers.email": "البريد الإلكتروني",
    "trainers.phone": "الهاتف",
    "trainers.mobile": "الجوال",
    "trainers.gender": "الجنس",
    "trainers.nationality": "الجنسية",
    "trainers.status": "الحالة",
    "trainers.country": "الدولة",
    "trainers.city": "المدينة",
    "trainers.address": "العنوان",
    "trainers.bio": "السيرة الذاتية",
    "trainers.hireDate": "تاريخ التعيين",
    "trainers.qualifications": "المؤهلات",
    "trainers.sessions": "الجلسات",
    "trainers.empty.title": "لا يوجد مدرِّبون بعد",
    "trainers.empty.subtitle": "أضف ملفات المدرِّبين لتعيينهم في الجلسات التدريبية",

    # ---- qualifications (356-369) ----
    "qualifications.title": "مؤهلات المدرِّبين",
    "qualifications.subtitle": "تتبُّع شهادات المدرِّبين واعتماداتهم",
    "qualifications.new": "مؤهل جديد",
    "qualifications.edit": "تحرير المؤهل",
    "qualifications.trainer": "المدرِّب",
    "qualifications.title2": "اسم المؤهل",
    "qualifications.issuer": "الجهة المانحة",
    "qualifications.credentialNumber": "رقم الاعتماد",
    "qualifications.issueDate": "تاريخ الإصدار",
    "qualifications.expiryDate": "تاريخ الانتهاء",
    "qualifications.document": "المستند",
    "qualifications.status": "الحالة",
    "qualifications.empty.title": "لا توجد مؤهلات بعد",
    "qualifications.empty.subtitle": "أضف الشهادات والاعتمادات لمدرِّبيك",

    # ---- courses (370-389) ----
    "courses.title": "الدورات التدريبية",
    "courses.subtitle": "إدارة كتالوج الدورات والمناهج",
    "courses.new": "دورة جديدة",
    "courses.edit": "تحرير الدورة",
    "courses.code": "رمز الدورة",
    "courses.status": "الحالة",
    "courses.title2": "عنوان الدورة",
    "courses.titleAr": "العنوان بالعربية",
    "courses.description": "الوصف",
    "courses.category": "الفئة",
    "courses.durationHours": "المدة (ساعات)",
    "courses.language": "اللغة",
    "courses.validityMonths": "الصلاحية (أشهر)",
    "courses.passScore": "درجة النجاح (٪)",
    "courses.maxTrainees": "الحد الأقصى للمتدرِّبين",
    "courses.hasPreTest": "يوجد اختبار قبلي",
    "courses.hasFinalTest": "يوجد اختبار نهائي",
    "courses.hasEvaluation": "يوجد تقييم",
    "courses.empty.title": "لا توجد دورات بعد",
    "courses.empty.subtitle": "ابنِ كتالوج الدورات لبدء جدولة التدريب",

    # ---- requests (390-419) ----
    "requests.title": "طلبات التدريب",
    "requests.subtitle": "مراجعة ومعالجة طلبات التدريب من المقاولين",
    "requests.new": "طلب جديد",
    "requests.import": "استيراد",
    "requests.export": "تصدير",
    "requests.import.success": "اكتمل الاستيراد: تم إنشاء {requests} طلب، وربط {trainees} متدرِّب",
    "requests.import.preview": "معاينة الاستيراد",
    "requests.import.previewing": "جارٍ المعاينة...",
    "requests.import.importing": "جارٍ الاستيراد...",
    "requests.import.confirm": "تأكيد الاستيراد",
    "requests.import.trainees": "متدرِّبون",
    "requests.import.totalRows": "إجمالي الصفوف",
    "requests.import.validRows": "صالح",
    "requests.import.invalidRows": "غير صالح",
    "requests.import.traineeCount": "المتدرِّبون",
    "requests.import.missingColumns": "أعمدة مطلوبة مفقودة",
    "requests.import.acceptedAlias": "عنوان مقبول",
    "requests.import.duplicateIds": "أرقام هوية مكررة",
    "requests.import.rows": "صفوف",
    "requests.import.matchedColumns": "أعمدة مطابقة",
    "requests.import.unmatchedHeaders": "عناوين غير مطابقة (تم تجاهلها)",
    "requests.import.rowPreview": "معاينة الصف",
    "requests.import.status": "الحالة",
    "requests.traineeName": "الاسم",
    "requests.nationalId": "رقم الهوية",
    "requests.addRow": "إضافة صف",
    "requests.searchTrainees": "ابحث عن المتدرِّبين...",
    "requests.deleteSelected": "حذف المحدد",
    "requests.noTraineesYet": "لا يوجد متدرِّبون بعد.",
    "requests.trainees": "المتدرِّبون",

    # ---- misc (420-421) ----
    "misc.cancel": "إلغاء",
    "misc.close": "إغلاق",

    # ---- requests continued (422-458) ----
    "requests.edit": "تحرير الطلب",
    "requests.requestNumber": "رقم الطلب",
    "requests.company": "الشركة",
    "requests.course": "الدورة",
    "requests.preferredDateFrom": "التاريخ المفضل من",
    "requests.preferredDateTo": "التاريخ المفضل إلى",
    "requests.preferredLocation": "الموقع المفضل",
    "requests.preferredLanguage": "اللغة المفضلة",
    "requests.priority": "الأولوية",
    "requests.notes": "ملاحظات",
    "requests.status": "الحالة",
    "requests.rejectionReason": "سبب الرفض",
    "requests.requestedBy": "طلبه",
    "requests.approvedBy": "اعتمده",
    "requests.approvedAt": "تاريخ الاعتماد",
    "requests.details": "تفاصيل الطلب",
    "requests.detailsSubtitle": "السجل الكامل وسجل سير العمل لهذا الطلب",
    "requests.generate.title": "توليد الجلسات",
    "requests.generate.subtitle": "جدولة جلسة لكل دورة معتمدة في هذا الطلب",
    "requests.generate.selectAtLeastOne": "اختر دورة واحدة على الأقل",
    "requests.generate.datesRequired": "يجب تحديد تاريخ البدء والانتهاء لكل دورة مختارة",
    "requests.generate.alreadyGenerated": "مجدول مسبقاً",
    "requests.generate.noCourses": "لا توجد دورات في هذا الطلب لجدولتها",
    "requests.generate.notApproved": "يمكن توليد الجلسات فقط من طلب معتمد (الحالة الحالية: {status})",
    "requests.generate.success": "تم توليد {count} جلسة",
    "requests.generate.hint": "سيتم إنشاء {count} جلسة ووضع علامة على الطلب كمجدول",
    "requests.timeline": "الخط الزمني",
    "requests.createdAt": "تاريخ الإنشاء",
    "requests.submittedAt": "تاريخ التقديم",
    "requests.reviewedAt": "بدأت المراجعة",
    "requests.scheduledAt": "مجدول",
    "requests.startedAt": "بدأت",
    "requests.completedAt": "مكتمل",
    "requests.rejectedAt": "مرفوض",
    "requests.noFurtherActions": "هذا الطلب مغلق — لا تتوفر إجراءات إضافية على سير العمل.",
    "requests.empty.title": "لا توجد طلبات تدريب بعد",
    "requests.empty.subtitle": "ستظهر طلبات التدريب المقدَّمة من المقاولين هنا",

    # ---- sessions (459-477) ----
    "sessions.title": "الجلسات التدريبية",
    "sessions.subtitle": "عرض وإدارة الجلسات التدريبية المجدولة",
    "sessions.new": "جلسة جديدة",
    "sessions.edit": "تحرير الجلسة",
    "sessions.sessionCode": "رقم الجلسة",
    "sessions.course": "الدورة",
    "sessions.trainer": "المدرِّب",
    "sessions.request": "الطلب",
    "sessions.title2": "عنوان الجلسة",
    "sessions.location": "الموقع",
    "sessions.language": "اللغة",
    "sessions.startDate": "تاريخ البدء",
    "sessions.endDate": "تاريخ الانتهاء",
    "sessions.expectedTrainees": "المتدرِّبون المتوقعون",
    "sessions.actualTrainees": "المتدرِّبون الفعليون",
    "sessions.status": "الحالة",
    "sessions.notes": "ملاحظات",
    "sessions.empty.title": "لا توجد جلسات مجدولة",
    "sessions.empty.subtitle": "جدول الجلسات التدريبية لإدارة التقديم والحضور",

    # ---- scheduling (478-485) ----
    "scheduling.title": "الجدولة",
    "scheduling.subtitle": "عرض التقويم للجلسات التدريبية",
    "scheduling.today": "اليوم",
    "scheduling.month": "الشهر",
    "scheduling.week": "الأسبوع",
    "scheduling.day": "اليوم",
    "scheduling.list": "قائمة",
    "scheduling.empty": "لا توجد جلسات مجدولة لهذه الفترة",

    # ---- attendance (486-502) ----
    "attendance.title": "الحضور",
    "attendance.subtitle": "تتبُّع حضور المتدرِّبين في الجلسات التدريبية",
    "attendance.session": "الجلسة",
    "attendance.traineeName": "اسم المتدرِّب",
    "attendance.traineeId": "رقم الهوية",
    "attendance.traineeEmail": "البريد الإلكتروني",
    "attendance.traineePhone": "الهاتف",
    "attendance.company": "الشركة",
    "attendance.checkInAt": "وقت تسجيل الحضور",
    "attendance.checkOutAt": "وقت تسجيل المغادرة",
    "attendance.status": "الحالة",
    "attendance.checkInMethod": "طريقة تسجيل الحضور",
    "attendance.notes": "ملاحظات",
    "attendance.scanQR": "مسح رمز QR",
    "attendance.manualCheckIn": "تسجيل حضور يدوي",
    "attendance.empty.title": "لا توجد سجلات حضور بعد",
    "attendance.empty.subtitle": "سيتم تسجيل الحضور عندما يسجِّل المتدرِّبون الدخول عبر رمز QR",

    # ---- check-in (503-519) ----
    "checkin.title": "تسجيل حضور الجلسة",
    "checkin.missingToken": "هذا الرابط يفتقد رمز تسجيل الحضور.",
    "checkin.invalidLink": "رابط تسجيل الحضور غير صالح",
    "checkin.fullName": "الاسم الكامل",
    "checkin.nameRequired": "يرجى إدخال اسمك الكامل",
    "checkin.nationalId": "رقم الهوية / الإقامة",
    "checkin.nationalIdHint": "اختياري، ولكنه يربط حضورك بسجل التدريب الخاص بك.",
    "checkin.email": "البريد الإلكتروني",
    "checkin.phone": "رقم الجوال",
    "checkin.submit": "تسجيل الحضور",
    "checkin.success": "تم تسجيل حضورك",
    "checkin.alreadyCheckedIn": "لقد سجَّلت حضورك مسبقاً",
    "checkin.preTestAssigned": "تم تعيين اختبار قبلي لك. سيبدأه مدرِّبك أثناء الجلسة.",
    "checkin.notYetOpen": "لم يُفتح تسجيل الحضور بعد",
    "checkin.closed": "تم إغلاق تسجيل الحضور لهذه الجلسة",
    "checkin.window": "مفتوح من {from} حتى {to}",
    "checkin.spotsRemaining": "{count} مكان متبقٍ",

    # ---- QR code (520-531) ----
    "qr.title": "رمز QR",
    "qr.subtitle": "إنشاء وإدارة رموز QR لتسجيل الحضور في الجلسات",
    "qr.selectSession": "اختر جلسة لإنشاء رمز QR الخاص بها",
    "qr.download": "تنزيل رمز QR",
    "qr.regenerate": "إعادة الإنشاء",
    "qr.print": "طباعة",
    "qr.scanInstructions": "يمسح المتدرِّبون هذا الرمز لتسجيل الحضور في الجلسة",
    "qr.token": "الرمز",
    "qr.expiresIn": "الرمز صالح حتى نهاية الجلسة",
    "qr.noToken": "لا يوجد رمز QR بعد — استخدم إعادة الإنشاء لإنشائه",
    "qr.copyFailed": "تعذَّر نسخ الرابط إلى الحافظة",
    "qr.popupBlocked": "حظر متصفحك نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع.",

    # ---- pre-test (532-549) ----
    "preTest.title": "الاختبار القبلي",
    "preTest.subtitle": "إدارة أسئلة ونتائج التقييم القبلي للتدريب",
    "preTest.questions": "الأسئلة",
    "preTest.results": "النتائج",
    "preTest.newQuestion": "سؤال جديد",
    "preTest.editQuestion": "تحرير السؤال",
    "preTest.questionText": "نص السؤال",
    "preTest.questionType": "نوع السؤال",
    "preTest.options": "خيارات الإجابة",
    "preTest.correctAnswers": "الإجابات الصحيحة",
    "preTest.points": "النقاط",
    "preTest.order": "الترتيب",
    "preTest.score": "الدرجة (٪)",
    "preTest.passed": "ناجح",
    "preTest.attemptedAt": "تاريخ المحاولة",
    "preTest.trainee": "المتدرِّب",
    "preTest.empty.title": "لا توجد أسئلة اختبار قبلي بعد",
    "preTest.empty.subtitle": "أضف أسئلة الاختبار القبلي لتقييم المعرفة الأساسية للمتدرِّبين",

    # ---- final-test (550-567) ----
    "finalTest.title": "الاختبار النهائي",
    "finalTest.subtitle": "إدارة أسئلة ونتائج التقييم النهائي",
    "finalTest.questions": "الأسئلة",
    "finalTest.results": "النتائج",
    "finalTest.newQuestion": "سؤال جديد",
    "finalTest.editQuestion": "تحرير السؤال",
    "finalTest.questionText": "نص السؤال",
    "finalTest.questionType": "نوع السؤال",
    "finalTest.options": "خيارات الإجابة",
    "finalTest.correctAnswers": "الإجابات الصحيحة",
    "finalTest.points": "النقاط",
    "finalTest.order": "الترتيب",
    "finalTest.score": "الدرجة (٪)",
    "finalTest.passed": "ناجح",
    "finalTest.attemptedAt": "تاريخ المحاولة",
    "finalTest.trainee": "المتدرِّب",
    "finalTest.empty.title": "لا توجد أسئلة اختبار نهائي بعد",
    "finalTest.empty.subtitle": "أضف أسئلة الاختبار النهائي لتقييم كفاءة المتدرِّبين",

    # ---- evaluation (568-588) ----
    "evaluation.title": "تقييم الدورة",
    "evaluation.subtitle": "ملاحظات المتدرِّبين حول تقديم التدريب ومحتواه",
    "evaluation.session": "الجلسة",
    "evaluation.trainer": "المدرِّب",
    "evaluation.trainee": "المتدرِّب",
    "evaluation.trainerRating": "المدرِّب",
    "evaluation.contentRating": "المحتوى",
    "evaluation.venueRating": "المكان",
    "evaluation.materialsRating": "المواد",
    "evaluation.overallRating": "الإجمالي",
    "evaluation.comments": "التعليقات",
    "evaluation.suggestions": "الاقتراحات",
    "evaluation.traineeEmail": "بريد المتدرِّب الإلكتروني",
    "evaluation.new": "تقييم جديد",
    "evaluation.edit": "تحرير التقييم",
    "evaluation.ratingRange": "يجب أن تكون جميع التقييمات بين 1 و 5",
    "evaluation.duplicate": "قدَّم هذا المتدرِّب تقييماً لهذه الجلسة مسبقاً",
    "evaluation.wouldRecommend": "يوصي به",
    "evaluation.submittedAt": "تاريخ التقديم",
    "evaluation.empty.title": "لم يتم تقديم تقييمات بعد",
    "evaluation.empty.subtitle": "ستظهر ملاحظات المتدرِّبين هنا بعد إكمال الدورة",

    # ---- certificates (589-603) ----
    "certificates.title": "الشهادات",
    "certificates.subtitle": "إصدار وتتبُّع شهادات إكمال التدريب",
    "certificates.new": "إصدار شهادة",
    "certificates.certificateNumber": "رقم الشهادة",
    "certificates.session": "الجلسة",
    "certificates.course": "الدورة",
    "certificates.company": "الشركة",
    "certificates.traineeName": "اسم المتدرِّب",
    "certificates.traineeId": "رقم الهوية",
    "certificates.traineeEmail": "البريد الإلكتروني",
    "certificates.finalScore": "الدرجة النهائية",
    "certificates.issuedAt": "تاريخ الإصدار",
    "certificates.validUntil": "ساري حتى",
    "certificates.status": "الحالة",
    "certificates.download": "تنزيل PDF",

    # ---- verify (604-613) ----
    "verify.title": "التحقق من الشهادة",
    "verify.valid": "تم التحقق",
    "verify.validDetail": "هذه الشهادة أصلية وسارية حالياً.",
    "verify.expired": "منتهية",
    "verify.expiredDetail": "كانت هذه الشهادة أصلية ولكن فترة صلاحيتها انتهت.",
    "verify.revoked": "مُبطَلة",
    "verify.revokedDetail": "تم إبطال هذه الشهادة ولم تعد معتمدة.",
    "verify.notFound": "غير موجودة",
    "verify.notFoundDetail": "لا توجد شهادة مطابقة لرابط التحقق. تأكد من نسخه بالكامل.",
    "verify.footer": "أُصدرت بواسطة مختبر الخليج — المختبر الخليجي",

    # ---- users (614-630) ----
    "users.new": "مستخدم جديد",
    "users.edit": "تحرير المستخدم",
    "users.fullName": "الاسم الكامل",
    "users.email": "البريد الإلكتروني",
    "users.role": "الدور",
    "users.password": "كلمة المرور",
    "users.newPassword": "كلمة مرور جديدة",
    "users.weakPassword": "يجب أن تكون كلمة المرور 8 أحرف على الأقل",
    "users.resetPassword": "إعادة تعيين كلمة المرور",
    "users.passwordReset": "تم تحديث كلمة المرور. شاركها مع المستخدم مباشرة — البريد الإلكتروني غير مفعَّل.",
    "users.lock": "قفل الحساب",
    "users.unlock": "إلغاء قفل الحساب",
    "users.loginHistory": "سجل تسجيل الدخول",
    "users.loginSuccess": "ناجح",
    "users.loginFailed": "فاشل",
    "users.noLogins": "لا توجد محاولات دخول مسجَّلة",
    "users.noLoginsSubtitle": "ستظهر محاولات تسجيل الدخول هنا",

    # ---- profile (631-641) ----
    "profile.title": "حسابي",
    "profile.subtitle": "تفاصيل حسابك ومستوى الوصول الخاص بك",
    "profile.company": "الشركة",
    "profile.language": "اللغة",
    "profile.status": "الحالة",
    "profile.active": "نشط",
    "profile.inactive": "غير نشط",
    "profile.lastLogin": "آخر تسجيل دخول",
    "profile.never": "لم يسجِّل الدخول مطلقاً",
    "profile.modules": "الوحدات التي يمكنك الوصول إليها",
    "profile.openSettings": "فتح الإعدادات",

    # ---- session detail (642-664) ----
    "session.enrollments": "التسجيلات",
    "session.enrolled": "متدرِّبون مسجَّلون",
    "session.enroll": "تسجيل متدرِّب",
    "session.noEnrollments": "لا يوجد متدرِّبون مسجَّلون",
    "session.noEnrollmentsSubtitle": "سجِّل المتدرِّبين لتتبُّع تقدُّمهم في هذه الجلسة",
    "session.lifecycle": "دورة الحياة",
    "session.lifecycleStatus": "الحالة الحالية",
    "session.lifecycleHint": "يتم تفعيل الانتقالات الصالحة من الحالة الحالية فقط.",
    "session.lifecycleDone": "هذه الجلسة مكتملة. لا يمكن إجراء المزيد من الانتقالات.",
    "session.event.STARTED": "بدء",
    "session.event.BREAK": "استراحة",
    "session.event.RESUMED": "استئناف",
    "session.event.COMPLETED": "إكمال",
    "session.finalTestsAssigned": "تم تعيين الاختبارات النهائية",
    "session.noShows": "لم يحضروا",
    "session.assignTrainer": "تعيين مدرِّب",
    "session.activateQr": "تفعيل تسجيل الحضور عبر QR",
    "session.qrActivated": "تم تفعيل تسجيل الحضور عبر QR",
    "session.generateFromRequest": "توليد تسجيلات من الطلب",
    "session.generateCertificates": "إنشاء الشهادات",
    "session.certificatesHint": "تُصدر الشهادات فقط للمتدرِّبين الذين حضروا، واجتازوا الاختبار النهائي، وقدَّموا تقييماً.",
    "session.generated": "تم الإنشاء",
    "session.skipped": "تم التخطي",

    # ---- report schedules (665-699) ----
    "schedules.title": "جداول التقارير",
    "schedules.subtitle": "تقارير آلية تُنشأ وفق جدول متكرر",
    "schedules.new": "جدول جديد",
    "schedules.edit": "تحرير الجدول",
    "schedules.name": "الاسم",
    "schedules.nameAr": "الاسم بالعربية",
    "schedules.description": "الوصف",
    "schedules.template": "القالب",
    "schedules.type": "التكرار",
    "schedules.schedule": "يُشغَّل",
    "schedules.executionTime": "وقت اليوم",
    "schedules.dayOfWeek": "يوم الأسبوع",
    "schedules.dayOfMonth": "يوم الشهر",
    "schedules.cron": "تعبير Cron",
    "schedules.formats": "صيغ التصدير",
    "schedules.recipients": "المستلمون",
    "schedules.recipientsHint": "عناوين بريد إلكتروني مفصولة بفواصل",
    "schedules.active": "نشط",
    "schedules.lastRun": "آخر تشغيل",
    "schedules.runNow": "تشغيل الآن",
    "schedules.runQueued": "بدأ تشغيل التقرير",
    "schedules.executions": "سجل التنفيذ",
    "schedules.status": "الحالة",
    "schedules.trigger": "المُشغِّل",
    "schedules.rowCount": "الصفوف",
    "schedules.emailStatus": "البريد",
    "schedules.attempt": "المحاولة",
    "schedules.startedAt": "بدأت",
    "schedules.retry": "إعادة المحاولة",
    "schedules.retryQueued": "بدأت إعادة المحاولة",
    "schedules.emailStub": "تُنشأ التقارير وتُخزَّن للتنزيل. يتطلب إرسال البريد تكوين SMTP في الإعدادات؛ حتى ذلك الحين، تُعلَّم عمليات التنفيذ \\",
    "schedules.empty.title": "لا توجد جداول تقارير",
    "schedules.empty.subtitle": "أنشئ جدولاً لإنشاء التقارير تلقائياً",
    "schedules.noExecutions": "لا توجد عمليات تنفيذ بعد",
    "schedules.noExecutionsSubtitle": "ستظهر عمليات التشغيل هنا بمجرد بدء الجدول",

    # ---- certificates (700-704) ----
    "certificates.verify": "تحقُّق",
    "certificates.verificationUrl": "رابط التحقق",
    "certificates.verificationCount": "عدد مرات التحقق",
    "certificates.empty.title": "لا توجد شهادات صادرة بعد",
    "certificates.empty.subtitle": "تُصدر الشهادات تلقائياً عند إكمال الدورة بنجاح",

    # ---- reports (705-723) ----
    "reports.title": "التقارير",
    "reports.subtitle": "تحليلات ورؤى حول عمليات التدريب",
    "reports.summary": "الملخص التنفيذي",
    "reports.byCompany": "التدريب حسب الشركة",
    "reports.byCourse": "التدريب حسب الدورة",
    "reports.byTrainer": "أداء المدرِّبين",
    "reports.byPeriod": "مقارنة الفترات",
    "reports.compliance": "تقرير الامتثال",
    "reports.attendance": "تقرير الحضور",
    "reports.scores": "تقرير درجات الاختبارات",
    "reports.exportPdf": "تصدير PDF",
    "reports.exportExcel": "تصدير Excel",
    "reports.exportUnavailable": "لا يوجد قالب تصدير متاح لهذه الصيغة",
    "reports.dateRange": "النطاق الزمني",
    "reports.from": "من",
    "reports.to": "إلى",
    "reports.generate": "إنشاء تقرير",
    "reports.empty.title": "لا توجد بيانات للإبلاغ عنها بعد",
    "reports.empty.subtitle": "ستتم تعبئة التقارير مع تسجيل الأنشطة التدريبية",

    # ---- notifications (724-733) ----
    "notifications.title": "الإشعارات",
    "notifications.subtitle": "ابقَ على اطلاع بأنشطة وتنبيهات التدريب",
    "notifications.markAllRead": "تعليم الكل كمقروء",
    "notifications.markRead": "تعليم كمقروء",
    "notifications.dismiss": "تجاهل",
    "notifications.unread": "غير مقروء",
    "notifications.empty.title": "لا توجد إشعارات",
    "notifications.empty.subtitle": "لا جديد لديك — تحقق لاحقاً للحصول على التحديثات",
    "notifications.filter.all": "الكل",
    "notifications.filter.unread": "غير مقروء",

    # ---- audit (734-744) ----
    "audit.title": "سجل التدقيق",
    "audit.subtitle": "سجل نشاط النظام للامتثال والأمان",
    "audit.user": "المستخدم",
    "audit.action": "الإجراء",
    "audit.entity": "الكيان",
    "audit.entityId": "معرِّف الكيان",
    "audit.description": "الوصف",
    "audit.ipAddress": "عنوان IP",
    "audit.timestamp": "الطابع الزمني",
    "audit.empty.title": "لا توجد سجلات تدقيق بعد",
    "audit.empty.subtitle": "سيتم تسجيل إجراءات النظام هنا للامتثال",

    # ---- settings (745-790) ----
    "settings.title": "الإعدادات",
    "settings.subtitle": "تكوين تفضيلات وسياسات النظام",
    "settings.tab.general": "عام",
    "settings.tab.branding": "الهوية البصرية",
    "settings.tab.notifications": "الإشعارات",
    "settings.tab.security": "الأمان",
    "settings.tab.email": "البريد الإلكتروني",
    "settings.tab.users": "المستخدمون والأدوار",
    "settings.systemName": "اسم النظام",
    "settings.defaultLanguage": "اللغة الافتراضية",
    "settings.timezone": "المنطقة الزمنية",
    "settings.dateFormat": "صيغة التاريخ",
    "settings.logoUrl": "رابط الشعار",
    "settings.primaryColor": "اللون الأساسي",
    "settings.passwordPolicy": "سياسة كلمة المرور",
    "settings.minLength": "الحد الأدنى للطول",
    "settings.requireUppercase": "يتطلب أحرفاً كبيرة",
    "settings.requireNumbers": "يتطلب أرقاماً",
    "settings.requireSymbols": "يتطلب رموزاً",
    "settings.sessionTimeout": "مهلة الجلسة (دقائق)",
    "settings.twoFactor": "المصادقة الثنائية",
    "settings.smtpHost": "خادم SMTP",
    "settings.smtpPort": "منفذ SMTP",
    "settings.smtpUser": "اسم مستخدم SMTP",
    "settings.smtpFrom": "بريد المُرسِل الإلكتروني",
    "settings.smtpPassword": "كلمة مرور SMTP",

    # ---- status (additional) (771-772) ----
    "status.SIMULATED": "لم يُرسل (لا يوجد SMTP)",
    "status.SUPERSEDED": "تم استبداله بإعادة المحاولة",

    # ---- schedules (files) (773-775) ----
    "schedules.files": "الملفات",
    "schedules.download": "تنزيل",
    "schedules.noFiles": "لا توجد ملفات مخزنة",

    # ---- settings continued (776-790) ----
    "settings.smtpPasswordSet": "•••••••• (مُكوَّن — اتركه فارغاً للإبقاء عليه)",
    "settings.smtpSecure": "استخدام TLS الضمني (المنفذ 465)",
    "settings.smtpSecureHint": "أوقفه للمنافذ 587 و 25، التي تتم ترقيتها عبر STARTTLS.",
    "settings.replyTo": "بريد الرد الإلكتروني",
    "settings.sendTest": "إرسال بريد تجريبي",
    "settings.emailTestHint": "يحفظ هذه الإعدادات، ثم يرسل رسالة تجريبية إلى عنوانك.",
    "settings.testSent": "تم إرسال بريد تجريبي إلى {to}.",
    "settings.testSimulated": "لم يتم تكوين SMTP، لذا لم يُرسل أي شيء.",
    "settings.testFailed": "تعذَّر إرسال البريد التجريبي.",
    "settings.users.title": "مستخدمو النظام",
    "settings.users.new": "مستخدم جديد",
    "settings.users.empty.title": "لا يوجد مستخدمون مُكوَّنون",
    "settings.users.empty.subtitle": "أضف مستخدمي النظام وعيِّن أدوارهم",
    "settings.save": "حفظ التغييرات",
    "settings.saved": "تم حفظ الإعدادات بنجاح",

    # ---- misc & questions (791-817) ----
    "misc.required": "مطلوب",
    "misc.optional": "اختياري",
    "questions.minOptions": "قدِّم خيارين على الأقل للإجابة",
    "questions.minCorrect": "علِّم إجابة صحيحة واحدة على الأقل",
    "misc.yes": "نعم",
    "misc.no": "لا",
    "misc.all": "الكل",
    "misc.none": "لا شيء",
    "misc.loading": "جارٍ التحميل...",
    "misc.saving": "جارٍ الحفظ...",
    "misc.success": "نجاح",
    "misc.error": "خطأ",
    "misc.warning": "تحذير",
    "misc.info": "معلومات",
    "misc.confirmDelete": "هل أنت متأكد من رغبتك في حذف هذا السجل؟",
    "misc.confirmDeleteDesc": "لا يمكن التراجع عن هذا الإجراء.",
    "misc.deleteSuccess": "تم حذف السجل بنجاح",
    "misc.saveSuccess": "تم حفظ السجل بنجاح",
    "misc.createSuccess": "تم إنشاء السجل بنجاح",
    "misc.updateSuccess": "تم تحديث السجل بنجاح",
    "misc.noAccess": "ليس لديك صلاحية الوصول إلى هذه الوحدة",
    "misc.pageUnderConstruction": "هذه الصفحة جزء من بنية النظام. اربط مصادر البيانات لتعبئتها.",
    "misc.noDataYet": "لا توجد بيانات للفترة المحددة بعد",
    "misc.noActivityYet": "لم يُسجَّل أي نشاط بعد",
    "misc.showing": "عرض",
    "misc.results": "نتائج",
    "misc.preview": "معاينة",
}


# --------------------------------------------------------------------------- #
# Main routine
# --------------------------------------------------------------------------- #
def main() -> int:
    input_path = Path("/tmp/en-keys.txt")
    output_path = Path("/tmp/ar-translations.json")

    # Read input file
    raw = input_path.read_text(encoding="utf-8")
    lines = raw.splitlines()

    # Parse keys (format: "key: value") — split on first colon
    keys_in_file: list[str] = []
    parse_errors: list[str] = []
    for idx, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        if ":" not in line:
            parse_errors.append(f"Line {idx}: no colon found: {line!r}")
            continue
        key, _value = line.split(":", 1)
        key = key.strip()
        if not key:
            parse_errors.append(f"Line {idx}: empty key: {line!r}")
            continue
        keys_in_file.append(key)

    # Detect duplicate keys in the input file
    seen: set[str] = set()
    dupes_in_file: list[str] = []
    for k in keys_in_file:
        if k in seen:
            dupes_in_file.append(k)
        seen.add(k)

    # Build translations result (preserve file order, last wins if dup)
    result: dict[str, str] = {}
    missing: list[str] = []
    for key in keys_in_file:
        if key in TRANSLATIONS:
            result[key] = TRANSLATIONS[key]
        else:
            missing.append(key)
            result[key] = ""

    # Detect keys defined in TRANSLATIONS but not present in the file
    file_keys_set = set(keys_in_file)
    extra_in_dict = sorted(set(TRANSLATIONS.keys()) - file_keys_set)

    # ---- Report ----
    print("=" * 70)
    print("Arabic Translation Generator — GCC Lab Training Management System")
    print("=" * 70)
    print(f"Input file          : {input_path}")
    print(f"Output file         : {output_path}")
    print(f"Lines parsed        : {len(keys_in_file)}")
    print(f"Unique keys in file : {len(file_keys_set)}")
    print(f"Translations defined: {len(TRANSLATIONS)}")
    print(f"Result entries      : {len(result)}")
    print(f"Missing translations: {len(missing)}")
    print(f"Extra dict entries  : {len(extra_in_dict)}")
    print(f"Parse errors        : {len(parse_errors)}")
    print(f"Duplicate keys file : {len(dupes_in_file)}")
    print("-" * 70)

    if parse_errors:
        print("\nPARSE ERRORS:")
        for e in parse_errors:
            print(f"  - {e}")

    if dupes_in_file:
        print("\nDUPLICATE KEYS IN FILE:")
        for k in dupes_in_file:
            print(f"  - {k}")

    if missing:
        print("\nMISSING TRANSLATIONS (no Arabic value provided):")
        for k in missing:
            print(f"  - {k}")

    if extra_in_dict:
        print("\nEXTRA DICT ENTRIES (not present in input file):")
        for k in extra_in_dict:
            print(f"  - {k}")

    # ---- Verify completeness ----
    all_translated = (
        len(keys_in_file) == 817
        and len(result) >= len(file_keys_set)
        and not missing
        and not extra_in_dict
    )

    print("-" * 70)
    if all_translated:
        print(f"SUCCESS: All {len(file_keys_set)} keys translated to Arabic.")
    else:
        print(f"WARNING: completeness check failed.")
    print("=" * 70)

    # ---- Write JSON output (UTF-8, RTL-friendly, pretty-printed) ----
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\nWrote {len(result)} Arabic translations to: {output_path}")

    # Final exit code: non-zero if anything missing
    return 0 if (not missing and not extra_in_dict and not parse_errors) else 1


if __name__ == "__main__":
    sys.exit(main())
